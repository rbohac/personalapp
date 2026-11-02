using System.Globalization;
using Bo.Api.Areas;
using Bo.Api.Data;
using Bo.Api.Schedules;
using Dapper;
using Npgsql;

namespace Bo.Api.Goals;

/// <param name="Measure">days (how many different days have an entry) or total (the sum of <paramref name="Field"/>).</param>
/// <param name="ExcludeValues">Entries whose <paramref name="ExcludeField"/> contains any of these don't count.</param>
/// <param name="Period">week: the target is for the whole week. day: for each day.</param>
public record GoalDto(
    Guid Id, string Title, string Area, string Measure, string? Field, string? Unit, decimal Target,
    string? ExcludeField, string[] ExcludeValues, bool Paused, GoalProgress Progress, string Period, GoalDay[] Days);

/// <summary>A per-day goal's value on one day (the last 7, oldest first).</summary>
public record GoalDay(string Day, decimal Value, bool Met);

/// <param name="Value">This week so far (Monday to now); for a per-day goal, today so far.</param>
/// <param name="DaysMet">Per-day goals: days this week the target was reached.</param>
/// <param name="DaysLeft">Days left this week, today included.</param>
/// <param name="LastWeek">Last week's value, for comparison.</param>
public record GoalProgress(decimal Value, decimal Target, bool Met, int DaysLeft, string Label, decimal LastWeek, int DaysMet = 0);

public record GoalInput(
    string Title, string Area, string Measure, decimal Target, string? Field = null,
    string? ExcludeField = null, string[]? ExcludeValues = null, bool Paused = false, string Period = "week");

internal sealed class GoalRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Title { get; set; } = "";
    public string Area { get; set; } = "";
    public string Measure { get; set; } = "days";
    public string? Field { get; set; }
    public decimal Target { get; set; }
    public string? ExcludeField { get; set; }
    public string[] ExcludeValues { get; set; } = [];
    public bool Paused { get; set; }
    public string Period { get; set; } = "week";

    public const string Columns =
        "id, user_id as userid, title, area, measure, field, target, exclude_field as excludefield, exclude_values as excludevalues, paused, period";
}

/// <summary>
/// Weekly goals, worked out from entries every time they're read: nothing
/// stores "met". A week is Monday to Sunday in the person's time zone.
/// </summary>
public sealed class GoalStore(Db db, AreaCatalog catalog)
{
    internal Db Db => db;
    internal AreaCatalog Catalog => catalog;

    public static DateOnly WeekStart(DateOnly day) => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));

    internal async Task SeedOnceAsync(NpgsqlConnection conn, Guid user)
    {
        await using var tx = await conn.BeginTransactionAsync();
        if (await conn.ExecuteAsync("update users set goals_seeded = true where id = @user and not goals_seeded", new { user }, tx) == 1)
        {
            var sort = 0;
            foreach (var g in catalog.StarterGoals)
                await conn.ExecuteAsync(
                    """
                    insert into goals (user_id, title, area, measure, field, target, exclude_field, exclude_values, sort, period)
                    values (@user, @Title, @Area, @Measure, @Field, @Target, @ExcludeField, @ExcludeValues, @sort, @Period)
                    """,
                    new { user, g.Title, g.Area, g.Measure, g.Field, g.Target, g.ExcludeField, g.ExcludeValues, sort = sort++, g.Period }, tx);
        }
        await tx.CommitAsync();
    }

    internal static async Task<List<GoalRow>> ListAsync(NpgsqlConnection conn, Guid user) =>
        (await conn.QueryAsync<GoalRow>($"select {GoalRow.Columns} from goals where user_id = @user order by sort, created_at", new { user })).ToList();

    /// <summary>The value for one week: distinct local days with a counting entry, or the field's sum.</summary>
    internal static Task<decimal> ValueAsync(NpgsqlConnection conn, GoalRow g, Clock clock, DateOnly weekStart) =>
        ValueAsync(conn, g, clock, weekStart, 7);

    /// <summary>The value over <paramref name="days"/> local days from <paramref name="from"/>.</summary>
    internal static async Task<decimal> ValueAsync(NpgsqlConnection conn, GoalRow g, Clock clock, DateOnly weekStart, int days)
    {
        var rows = await conn.QueryAsync<(DateTime At, string? Value)>(
            """
            select at, case when @field::text is null then null else data->>@field end
            from entries
            where user_id = @user and area = @area and at >= @from and at < @to
              -- A logged skip ("skipped my walk") doesn't count.
              and coalesce(data->>'done', 'true') <> 'false'
              and (@ef::text is null or not exists (
                    select 1 from unnest(@ev::text[]) v where coalesce(data->>@ef, '') ilike '%' || v || '%'))
            """,
            new
            {
                user = g.UserId, area = g.Area, field = g.Measure == "total" ? g.Field : null,
                from = clock.Utc(weekStart, 0), to = clock.Utc(weekStart.AddDays(days), 0),
                ef = g.ExcludeField is { Length: > 0 } && g.ExcludeValues.Length > 0 ? g.ExcludeField : null, ev = g.ExcludeValues,
            });
        return g.Measure == "days"
            ? rows.Select(r => clock.Today(r.At)).Distinct().Count()
            : rows.Sum(r => decimal.TryParse(r.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0);
    }

    internal async Task<GoalDto> DtoAsync(NpgsqlConnection conn, GoalRow g, Clock clock, DateTime utcNow)
    {
        var today = clock.Today(utcNow);
        var week = WeekStart(today);
        if (g.Period == "day") return await DailyDtoAsync(conn, g, clock, today, week);
        var value = await ValueAsync(conn, g, clock, week);
        var last = await ValueAsync(conn, g, clock, week.AddDays(-7));
        var unit = Unit(g);
        var label = $"{Num(value)} of {Num(g.Target)} {unit}".TrimEnd();
        return new GoalDto(g.Id, g.Title, g.Area, g.Measure, g.Field, unit, g.Target, g.ExcludeField, g.ExcludeValues, g.Paused,
            new GoalProgress(value, g.Target, value >= g.Target, 7 - (today.DayNumber - week.DayNumber), label, last), g.Period, []);
    }

    /// <summary>A per-day goal: today so far, the last 7 days, and how many days this week reached it.</summary>
    private async Task<GoalDto> DailyDtoAsync(NpgsqlConnection conn, GoalRow g, Clock clock, DateOnly today, DateOnly week)
    {
        var days = new List<GoalDay>();
        for (var d = today.AddDays(-6); d <= today; d = d.AddDays(1))
        {
            var v = await ValueAsync(conn, g, clock, d, 1);
            days.Add(new GoalDay(ScheduleLogic.Iso(d), v, v >= g.Target));
        }
        var daysMet = 0;
        for (var d = week; d <= today; d = d.AddDays(1))
            if (await ValueAsync(conn, g, clock, d, 1) >= g.Target) daysMet++;
        var lastWeekMet = 0;
        for (var d = week.AddDays(-7); d < week; d = d.AddDays(1))
            if (await ValueAsync(conn, g, clock, d, 1) >= g.Target) lastWeekMet++;
        var value = days[^1].Value;
        var unit = Unit(g);
        var label = $"{Num(value)} of {Num(g.Target)} {unit} today".Replace("  ", " ");
        return new GoalDto(g.Id, g.Title, g.Area, g.Measure, g.Field, unit, g.Target, g.ExcludeField, g.ExcludeValues, g.Paused,
            new GoalProgress(value, g.Target, value >= g.Target, 7 - (today.DayNumber - week.DayNumber), label, lastWeekMet, daysMet),
            g.Period, [.. days]);
    }

    /// <summary>"days", or the field's unit ("mi").</summary>
    internal string Unit(GoalRow g) =>
        g.Measure == "days" ? (g.Target == 1 ? "day" : "days")
        : catalog.Find(g.Area)?.Fields.FirstOrDefault(f => f.Key == g.Field)?.Unit ?? "";

    internal static string Num(decimal d) => d.ToString("0.#", CultureInfo.InvariantCulture);

    /// <summary>
    /// The weekly pushes: Thursday 6 PM, a mid-week check if anything's
    /// behind; Sunday 6 PM, how the week went. Once each per week.
    /// </summary>
    internal async Task<(string Kind, string Week, PushMessage Message)?> WeeklyPushAsync(NpgsqlConnection conn, Guid user, Clock clock, DateTime utcNow)
    {
        var local = clock.Local(utcNow);
        if (local.Hour < 18 || clock.Quiet(utcNow)) return null;
        var kind = local.DayOfWeek switch { DayOfWeek.Thursday => "midweek", DayOfWeek.Sunday => "summary", _ => null };
        if (kind is null) return null;

        var goals = (await ListAsync(conn, user)).Where(g => !g.Paused).ToList();
        if (goals.Count == 0) return null;
        var dtos = new List<GoalDto>();
        foreach (var g in goals) dtos.Add(await DtoAsync(conn, g, clock, utcNow));
        // A per-day goal is on track when every day so far this week reached it.
        var elapsed = clock.Today(utcNow).DayNumber - WeekStart(clock.Today(utcNow)).DayNumber + 1;
        bool Good(GoalDto d) => d.Period == "day" ? d.Progress.DaysMet >= elapsed : d.Progress.Met;
        string Line(GoalDto d) => d.Period == "day" ? $"{d.Title} {d.Progress.DaysMet} of {elapsed} days" : $"{d.Title} {d.Progress.Label}";
        if (kind == "midweek" && dtos.All(Good)) return null;

        var lines = string.Join(" · ", dtos.Select(d => $"{(Good(d) ? "✓ " : "")}{Line(d)}"));
        var met = dtos.Count(Good);
        var title = kind == "midweek" ? "Halfway through the week" : $"Your week: {met} of {dtos.Count} goals";
        return (kind, ScheduleLogic.Iso(WeekStart(clock.Today(utcNow))), new PushMessage(title, lines, new { kind = "goals" }));
    }
}
