using System.Globalization;
using System.Text.Json;
using Bo.Api.Ask;
using Bo.Api.Auth;
using Bo.Api.Data;
using Bo.Api.Schedules;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

public record BpPoint(DateTime At, int Systolic, int Diastolic, int? Pulse);
public record ValuePoint(string Day, decimal Value);
public record CountItem(string Name, int Count);

/// <summary>Blood pressure readings in the window, oldest first, with their averages.</summary>
public record BpTrend(BpPoint[] Readings, int? AvgSystolic, int? AvgDiastolic, int? PrevAvgSystolic, int? PrevAvgDiastolic);
public record WeightTrend(ValuePoint[] Points, decimal? Latest, decimal? Change);
/// <param name="Days">One value per day in the window, zero days included.</param>
public record DailyTrend(ValuePoint[] Days, decimal Average, decimal? Target, int DaysMet);
/// <param name="DaysLogged">Days with any medication logged.</param>
public record MedsTrend(int DaysLogged, int Days, CountItem[] Skipped);
public record SleepTrend(int Nights, int CleanNights, int CarbNights, decimal? AvgCpapHours, int? AvgCpapScore, int? AvgAwakeMinutes, ValuePoint[] AwakeMinutes);

/// <summary>A window of days, worked out from entries on every read.</summary>
public record TrendsDto(int Days, string From, string To, BpTrend BloodPressure, WeightTrend Weight, DailyTrend Protein,
    DailyTrend Household, MedsTrend Meds, CountItem[] Shots, SleepTrend Sleep);

/// <summary>Ask Bo questions about the data, and the Trends screen.</summary>
public static class AskTrendsEndpoints
{
    public static void MapAskTrendsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/ask", async (AskRequest body, HttpContext http, AskService ask, CancellationToken ct) =>
            TypedResults.Ok(await ask.AskAsync(http.User.UserId(), body, ct))).WithTags("Ask").RequireAuthorization();

        app.MapGet("/trends", Trends).WithTags("Trends").RequireAuthorization();
    }

    private sealed record Row(DateTime At, string Area, string Data);

    /// <summary>The last <c>days</c> days (7–365, default 30) ending today, local time.</summary>
    private static async Task<Ok<TrendsDto>> Trends(HttpContext http, Db db, CancellationToken ct, string? tz = null, int days = 30)
    {
        days = Math.Clamp(days, 7, 365);
        var user = http.User.UserId();
        await using var conn = await db.OpenAsync(ct);
        await ScheduleStore.SetZoneAsync(conn, user, tz);
        var clock = await ScheduleStore.ClockAsync(conn, user);
        var today = clock.Today(DateTime.UtcNow);
        var from = today.AddDays(-(days - 1));
        var prevFrom = from.AddDays(-days);
        var rows = (await conn.QueryAsync<Row>(
            "select at, area, data::text as data from entries where user_id = @user and at >= @start order by at",
            new { user, start = clock.Utc(prevFrom, 0) })).ToList();
        var current = rows.Where(r => clock.Today(r.At) >= from).ToList();
        var previous = rows.Where(r => clock.Today(r.At) < from).ToList();
        var dayList = Enumerable.Range(0, days).Select(i => from.AddDays(i)).ToList();

        Dictionary<string, JsonElement> D(Row r) => JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(r.Data) ?? [];
        decimal? N(Dictionary<string, JsonElement> d, string k) =>
            d.TryGetValue(k, out var v) ? v.ValueKind == JsonValueKind.Number ? v.GetDecimal()
                : decimal.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var x) ? x : null : null;
        string? S(Dictionary<string, JsonElement> d, string k) => d.TryGetValue(k, out var v) ? v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText() : null;

        // Blood pressure
        BpPoint[] Bp(IEnumerable<Row> rs) => rs.Where(r => r.Area == "blood-pressure").Select(r => (r, d: D(r)))
            .Where(x => N(x.d, "systolic") is not null && N(x.d, "diastolic") is not null)
            .Select(x => new BpPoint(x.r.At, (int)N(x.d, "systolic")!, (int)N(x.d, "diastolic")!, N(x.d, "pulse") is { } p ? (int)p : null)).ToArray();
        var bp = Bp(current);
        var bpPrev = Bp(previous);
        int? Avg(IEnumerable<int> xs) => xs.Any() ? (int)Math.Round(xs.Average()) : null;
        var bloodPressure = new BpTrend(bp, Avg(bp.Select(b => b.Systolic)), Avg(bp.Select(b => b.Diastolic)),
            Avg(bpPrev.Select(b => b.Systolic)), Avg(bpPrev.Select(b => b.Diastolic)));

        // Weight
        var weights = current.Where(r => r.Area == "weight").Select(r => (r.At, w: N(D(r), "pounds"))).Where(x => x.w is not null)
            .Select(x => new ValuePoint(ScheduleLogic.Iso(clock.Today(x.At)), x.w!.Value)).ToArray();
        var weight = new WeightTrend(weights, weights.LastOrDefault()?.Value,
            weights.Length > 1 ? weights[^1].Value - weights[0].Value : null);

        // A per-day sum of one field
        DailyTrend Daily(string area, string field, decimal? target)
        {
            var byDay = current.Where(r => r.Area == area).GroupBy(r => clock.Today(r.At))
                .ToDictionary(g => g.Key, g => g.Sum(r => N(D(r), field) ?? 0));
            var series = dayList.Select(d => new ValuePoint(ScheduleLogic.Iso(d), byDay.GetValueOrDefault(d))).ToArray();
            return new DailyTrend(series, Math.Round(series.Average(p => p.Value), 1), target,
                target is { } t ? series.Count(p => p.Value >= t) : 0);
        }
        var latestWeight = rows.Where(r => r.Area == "weight").Select(r => N(D(r), "pounds")).LastOrDefault(w => w is not null)
            ?? await conn.ExecuteScalarAsync<decimal?>(
                "select (data->>'pounds')::numeric from entries where user_id = @user and area = 'weight' order by at desc limit 1", new { user });
        var protein = Daily("nutrition", "protein", latestWeight is { } lw ? Math.Round(lw) : null);
        var household = Daily("household", "minutes", 15);

        // Medications: days with any logged, and items skipped on the daily list
        var medDays = current.Where(r => r.Area == "medications").Select(r => clock.Today(r.At)).Distinct().Count();
        var skipped = (await conn.QueryAsync<(string Item, int Count)>(
            """
            select m.item, count(*)::int from schedule_marks m join schedules s on s.id = m.schedule_id
            where s.user_id = @user and m.state = 'skipped' and m.day >= @from::date
            group by m.item order by 2 desc
            """, new { user, from = ScheduleLogic.Iso(from) })).Select(x => new CountItem(x.Item, x.Count)).ToArray();
        var meds = new MedsTrend(medDays, days, skipped);

        // Shots taken, by medication
        var shots = current.Where(r => r.Area == "shots").Select(D).Where(d => (S(d, "event") ?? "taken") == "taken")
            // By the medication's name: "Tirzepatide 5mg" and "tirzepatide" are one.
            .GroupBy(d => (S(d, "medication") ?? "shot").Trim().Split(' ', 2)[0].ToLowerInvariant())
            .Select(g => new CountItem(Cap(g.Key), g.Count())).OrderByDescending(x => x.Count).ToArray();

        // Sleep
        var nights = current.Where(r => r.Area == "sleep").Select(r => (r.At, d: D(r))).ToList();
        var cpapH = nights.Select(n => N(n.d, "cpap_hours")).Where(x => x is not null).ToList();
        var cpapS = nights.Select(n => N(n.d, "cpap_score")).Where(x => x is not null).ToList();
        var awake = nights.Select(n => N(n.d, "awake_minutes")).Where(x => x is not null).ToList();
        var sleep = new SleepTrend(
            nights.Count,
            nights.Count(n => S(n.d, "snack") is null or "none"),
            nights.Count(n => S(n.d, "snack") == "carbs"),
            cpapH.Count > 0 ? Math.Round(cpapH.Average(x => x!.Value), 1) : null,
            cpapS.Count > 0 ? (int)Math.Round(cpapS.Average(x => x!.Value)) : null,
            awake.Count > 0 ? (int)Math.Round(awake.Average(x => x!.Value)) : null,
            nights.Where(n => N(n.d, "awake_minutes") is not null)
                .Select(n => new ValuePoint(ScheduleLogic.Iso(clock.Today(n.At)), N(n.d, "awake_minutes")!.Value)).ToArray());

        return TypedResults.Ok(new TrendsDto(days, ScheduleLogic.Iso(from), ScheduleLogic.Iso(today),
            bloodPressure, weight, protein, household, meds, shots, sleep));
    }

    private static string Cap(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];
}
