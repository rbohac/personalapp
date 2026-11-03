using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Bo.Api.Ai;
using Bo.Api.Areas;
using Bo.Api.Data;
using Bo.Api.Goals;
using Bo.Api.Schedules;
using Dapper;

namespace Bo.Api.Ask;

/// <summary>One earlier turn of the conversation, so a follow-up ("and last month?") makes sense.</summary>
public record AskTurn(string Question, string Answer);

/// <param name="Days">How far back to look, 7–365 (default 90).</param>
public record AskRequest(string Question, string? TimeZone = null, AskTurn[]? History = null, int Days = 90);

/// <summary>An optional small chart: one value per point, oldest first.</summary>
public record AskChart(string Title, string? Unit, AskPoint[] Points);
public record AskPoint(string Label, decimal Value);

/// <param name="Answer">Plain text, a few sentences.</param>
/// <param name="AskId">The recorded AI call (AI usage and cost).</param>
public record AskResult(string Answer, AskChart? Chart, Guid? AskId);

/// <summary>
/// Questions in plain words about what's been logged: "how's my BP since I
/// started the patch?". The model is handed the person's entries, schedules
/// and goals as compact lines and answers from them only, in a fixed JSON
/// shape. Every call is recorded like a capture (feature "ask").
/// </summary>
public sealed class AskService(Db db, AreaCatalog catalog, GoalStore goals, IModelClient model, AiUsageStore usage, IConfiguration config, ILogger<AskService> log)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int MaxEntries = 2500;
    private readonly string _effort = config["Ask:Effort"] is { Length: > 0 } e ? e : "medium";

    public async Task<AskResult> AskAsync(Guid user, AskRequest req, CancellationToken ct)
    {
        var question = (req.Question ?? "").Trim();
        if (question.Length == 0) return new AskResult("Ask me something about what you've logged.", null, null);
        if (question.Length > 1000) question = question[..1000];

        if (!model.Configured) return await Record(user, question, "not_configured", null, null, "The AI model isn't set up, so I can't answer questions yet.", null, ct);
        var budget = usage.Options.MonthlyBudgetUsd;
        await using (var c0 = await db.OpenAsync(ct))
        {
            await ScheduleStore.SetZoneAsync(c0, user, req.TimeZone);
        }
        var zoneId = req.TimeZone is { Length: > 0 } z && TimeZoneInfo.TryFindSystemTimeZoneById(z, out _) ? z : "UTC";
        if (budget > 0 && await usage.MonthSpendAsync(user, zoneId, ct) >= budget)
            return await Record(user, question, "over_budget", null, null, $"This month's AI budget (${budget:0.00##}) is used up, so I can't answer until next month.", null, ct);

        var userMessage = await ContextAsync(user, question, req, ct);
        var request = new ModelRequest(System, userMessage, Schema(), _effort);
        var clock = Stopwatch.StartNew();
        try
        {
            var reply = await model.CompleteJsonAsync(request, ct);
            var cost = usage.Options.CostOf(model.Provider, model.Model, reply.Usage);
            var call = new Call(model.Provider, model.Model, reply.Usage, cost, (int)clock.ElapsedMilliseconds, userMessage, reply.Text);
            if (reply.Stop != ModelStop.Done)
                return await Record(user, question, reply.Stop == ModelStop.Refused ? "refused" : "out_of_room", call, null,
                    "I couldn't answer that one. Try asking it a different way.", null, ct);
            var output = JsonSerializer.Deserialize<Output>(reply.Text, Json);
            var chart = output?.Chart is { Points.Length: > 1 } ch
                ? ch with { Points = ch.Points.Take(60).ToArray() }
                : null;
            return await Record(user, question, "ok", call, null, output?.Answer?.Trim() is { Length: > 0 } a ? a : "I couldn't find an answer in your data.", chart, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "Ask failed.");
            return await Record(user, question, "error", new Call(model.Provider, model.Model, new(0, 0, 0, 0), null, (int)clock.ElapsedMilliseconds, userMessage, null),
                e.Message, "Couldn't reach the AI model just now. Try again in a moment.", null, ct);
        }
    }

    private sealed record Call(string Provider, string Model, ModelUsage Usage, decimal? Cost, int LatencyMs, string Request, string? Response);
    private sealed record Output(string? Answer, AskChart? Chart);

    private async Task<AskResult> Record(Guid user, string question, string outcome, Call? c, string? error, string answer, AskChart? chart, CancellationToken ct)
    {
        var id = await usage.RecordAsync(new AiCall(
            user, "ask", c?.Provider, c?.Model, outcome, "model", c?.Usage ?? new(0, 0, 0, 0), c is null ? 0m : c.Cost, c?.LatencyMs,
            0, question, "typed", c?.Request, c?.Response, null, answer, error), ct);
        return new AskResult(answer, chart, id);
    }

    private const string System = """
        You are Bo, a personal health and habits log for one person. You answer
        their questions about what they have logged, using only the data in the
        <data> block. You are talking to the owner of the data.

        How to answer:
        - Answer from the data only. If it doesn't hold the answer, say what's
          missing in one sentence ("You haven't logged sleep before Nov 3.").
        - Be short and concrete: 1–4 sentences. Lead with the answer. Use
          numbers, dates and counts from the data; say how many readings an
          average is over.
        - Dates as "Nov 3", times as "7:10 am". Units as logged (lb, g, units).
        - When comparing periods, name both periods and both numbers.
        - Never invent readings or fill gaps with guesses. Estimated values are
          marked (est.) in the data; say so when they matter.
        - This is not medical advice. Don't diagnose or change treatment. When a
          reading is well outside normal ranges (e.g. blood pressure at or above
          140/90 repeatedly), you may note it plainly and suggest mentioning it to
          their doctor, once, briefly.
        - Earlier questions and answers are in <history>; use them to understand
          a follow-up like "and last month?".

        Chart:
        - Include a chart only when a trend over time or a comparison across a
          few groups answers the question better than words: 2 to 60 points,
          oldest first, one number each, with a short label (a date like
          "Nov 3", or a group name). Otherwise chart is null.
        """;

    private async Task<string> ContextAsync(Guid user, string question, AskRequest req, CancellationToken ct)
    {
        var days = Math.Clamp(req.Days, 7, 365);
        await using var conn = await db.OpenAsync(ct);
        var clock = await ScheduleStore.ClockAsync(conn, user);
        var now = DateTime.UtcNow;
        var local = clock.Local(now);
        var sb = new StringBuilder();
        sb.AppendLine($"Today is {local:dddd, MMM d, yyyy}, {local:h:mm tt} ({clock.Zone.Id}).");
        sb.AppendLine().AppendLine("<data>");

        // Entries, oldest first, one line each: when, area, what (the summary plus any field the summary leaves out).
        var rows = (await conn.QueryAsync<(DateTime At, string Area, string Data)>(
            "select at, area, data::text from entries where user_id = @user and at >= @from order by at desc limit @max",
            new { user, from = now.AddDays(-days), max = MaxEntries })).Reverse().ToList();
        sb.AppendLine($"## Entries, last {days} days ({rows.Count}{(rows.Count == MaxEntries ? ", most recent only" : "")})");
        foreach (var r in rows)
        {
            var area = catalog.Find(r.Area);
            var data = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(r.Data) ?? [];
            var fields = string.Join("; ", data.Select(kv => $"{kv.Key}={Text(kv.Value)}"));
            sb.AppendLine($"{clock.Local(r.At):yyyy-MM-dd HH:mm} {area?.Name ?? r.Area}: {fields}");
        }

        sb.AppendLine().AppendLine("## Schedules");
        foreach (var s in await ScheduleStore.ListAsync(conn, user))
        {
            await ScheduleStore.SyncAsync(conn, s, clock);
            var d = await ScheduleStore.DtoAsync(conn, s, clock, now);
            sb.AppendLine($"- {s.Title}: every {s.EveryDays} day(s){(s.Weekdays.Length > 0 ? $" on {string.Join(",", s.Weekdays.Select(w => (DayOfWeek)w))}" : "")} at {ScheduleLogic.Hhmm(s.AtMinute)}; " +
                          $"status: {d.Status.Label}; next due {d.NextDue ?? "-"}; dose {d.NextDose ?? "-"}; items: {(s.Items.Length > 0 ? string.Join(", ", s.Items) : "-")}{(s.Paused ? "; paused" : "")}");
        }

        sb.AppendLine().AppendLine("## Goals (this week)");
        foreach (var g in await GoalStore.ListAsync(conn, user))
        {
            var d = await goals.DtoAsync(conn, g, clock, now);
            sb.AppendLine($"- {g.Title} ({(g.Period == "day" ? "per day" : "per week")}, target {GoalStore.Num(d.Target)} {d.Unit}): {d.Progress.Label}{(g.Paused ? "; paused" : "")}");
        }
        sb.AppendLine("</data>");

        if (req.History is { Length: > 0 } h)
        {
            sb.AppendLine().AppendLine("<history>");
            foreach (var t in h.TakeLast(6)) sb.AppendLine($"Q: {Trim(t.Question, 500)}").AppendLine($"A: {Trim(t.Answer, 1000)}");
            sb.AppendLine("</history>");
        }
        sb.AppendLine().AppendLine("<question>").AppendLine(question).AppendLine("</question>");
        return sb.ToString();
    }

    private static string Text(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => v.GetString() ?? "",
        JsonValueKind.Number => v.GetDecimal().ToString("0.##", CultureInfo.InvariantCulture),
        JsonValueKind.True => "yes",
        JsonValueKind.False => "no",
        _ => v.GetRawText(),
    };

    private static string Trim(string s, int max) => s.Length > max ? s[..max] : s;

    private static Dictionary<string, JsonElement> Schema()
    {
        var schema = new
        {
            type = "object",
            additionalProperties = false,
            required = new[] { "answer", "chart" },
            properties = new
            {
                answer = new { type = "string" },
                chart = new
                {
                    anyOf = new object[]
                    {
                        new { type = "null" },
                        new
                        {
                            type = "object",
                            additionalProperties = false,
                            required = new[] { "title", "unit", "points" },
                            properties = new
                            {
                                title = new { type = "string" },
                                unit = new { anyOf = new object[] { new { type = "string" }, new { type = "null" } } },
                                points = new
                                {
                                    type = "array",
                                    items = new
                                    {
                                        type = "object",
                                        additionalProperties = false,
                                        required = new[] { "label", "value" },
                                        properties = new { label = new { type = "string" }, value = new { type = "number" } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };
        return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(schema))!;
    }
}
