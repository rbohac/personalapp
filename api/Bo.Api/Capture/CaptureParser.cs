using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Bo.Api.Ai;
using Bo.Api.Areas;

namespace Bo.Api.Capture;

/// <summary>
/// Turns "took my BP 120/80, pulse 72" into proposals. The model reads the
/// areas folder — _capture.md plus every area's README and fields — and
/// answers in a fixed JSON schema; every value it returns then goes through
/// the same validation as a hand-entered one. When the model isn't configured,
/// can't be reached, declines, or the monthly budget is spent, the areas'
/// fallback patterns read what they can.
///
/// Every capture is recorded through <see cref="AiUsageStore"/>: what it cost
/// (kept forever) and the words (kept for the retention window).
/// </summary>
public sealed class CaptureParser(AreaCatalog catalog, IModelClient model, AiUsageStore usage, IConfiguration config, ILogger<CaptureParser> log)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // Effort is how much the model thinks before answering. medium is Haiku's
    // default and the level Anthropic recommends where instructions must be
    // followed exactly ("never invent a number"); low is cheaper and faster.
    private readonly string _effort = config["Capture:Effort"] is { Length: > 0 } e ? e : "medium";

    public async Task<CaptureResult> ParseAsync(Guid userId, CaptureRequest req, IReadOnlyList<(string Area, string Summary, DateTime At)> recent, CancellationToken ct)
    {
        var zone = ZoneOf(req.TimeZone);
        var now = DateTimeOffset.UtcNow;
        var call = new Draft(userId, req.Text, req.Source);

        if (!model.Configured)
            return await Finish(call with { Outcome = "not_configured" },
                WithPatterns(req.Text, now, "The model isn't configured, so only plain readings are understood."), ct);

        var budget = usage.Options.MonthlyBudgetUsd;
        if (budget > 0 && await usage.MonthSpendAsync(userId, zone.Id, ct) >= budget)
            return await Finish(call with { Outcome = "over_budget" },
                WithPatterns(req.Text, now, $"This month's AI budget (${budget:0.00##}) is used up, so only plain readings are understood."), ct);

        var request = new ModelRequest(SystemPrompt(), UserMessage(req.Text, local: TimeZoneInfo.ConvertTime(now, zone), zone, recent), Schema(), _effort);
        call = call with { Provider = model.Provider, Model = model.Model, Request = request.User };
        var clock = Stopwatch.StartNew();
        try
        {
            var reply = await model.CompleteJsonAsync(request, ct);
            call = call with
            {
                LatencyMs = (int)clock.ElapsedMilliseconds,
                Usage = reply.Usage,
                CostUsd = usage.Options.CostOf(model.Provider, model.Model, reply.Usage),
                Response = reply.Text,
            };

            if (reply.Stop == ModelStop.Refused)
                return await Finish(call with { Outcome = "refused" },
                    WithPatterns(req.Text, now, "The model declined to read that, so only plain readings were understood."), ct);
            if (reply.Stop == ModelStop.OutOfRoom)
                return await Finish(call with { Outcome = "out_of_room" },
                    WithPatterns(req.Text, now, "The model ran out of room before answering, so only plain readings were understood."), ct);

            var output = JsonSerializer.Deserialize<ModelOutput>(reply.Text, Json) ?? new ModelOutput([], null);
            var proposals = output.Captures.Select(c => FromModel(c, now)).OfType<Proposal>().ToArray();
            return await Finish(call with { Outcome = "ok", Parser = "model" }, new CaptureResult(proposals, "model", output.Note), ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "Capture model call failed; falling back to patterns.");
            return await Finish(call with { Outcome = "error", LatencyMs = (int)clock.ElapsedMilliseconds, Error = e.Message },
                WithPatterns(req.Text, now, "Couldn't reach the model, so only plain readings were understood."), ct);
        }
    }

    /// <summary>What's known about a capture as it runs; recorded once it ends.</summary>
    private sealed record Draft(Guid UserId, string Input, string Source)
    {
        public string Outcome { get; init; } = "ok";
        public string Parser { get; init; } = "patterns";
        public string? Provider { get; init; }
        public string? Model { get; init; }
        public ModelUsage Usage { get; init; } = new(0, 0, 0, 0);
        public decimal? CostUsd { get; init; }
        public int? LatencyMs { get; init; }
        public string? Request { get; init; }
        public string? Response { get; init; }
        public string? Error { get; init; }
    }

    private async Task<CaptureResult> Finish(Draft d, CaptureResult result, CancellationToken ct)
    {
        // A call that never reached a model cost nothing, which is known, not unknown.
        var cost = d.Provider is null ? 0m : d.CostUsd;
        var id = await usage.RecordAsync(new AiCall(
            d.UserId, "capture", d.Provider, d.Model, d.Outcome, d.Parser, d.Usage, cost, d.LatencyMs,
            result.Proposals.Length, d.Input, d.Source, d.Request, d.Response, result.Proposals, result.Note, d.Error), ct);
        return result with { CaptureId = id };
    }

    private static string UserMessage(string text, DateTimeOffset local, TimeZoneInfo zone, IReadOnlyList<(string Area, string Summary, DateTime At)> recent)
    {
        var user = new StringBuilder()
            .AppendLine($"Local time now: {local:yyyy-MM-dd'T'HH:mm:sszzz} ({zone.Id}, {local:dddd})")
            .AppendLine()
            .AppendLine("Most recent entry in each area:");
        foreach (var (area, summary, at) in recent)
            user.AppendLine($"- {area}: {summary} ({TimeZoneInfo.ConvertTime(new DateTimeOffset(at, TimeSpan.Zero), zone):yyyy-MM-dd HH:mm})");
        if (recent.Count == 0) user.AppendLine("- (none yet)");
        user.AppendLine().AppendLine("<capture>").AppendLine(text).AppendLine("</capture>");
        return user.ToString();
    }

    private Proposal? FromModel(ModelCapture c, DateTimeOffset now)
    {
        var area = catalog.Find(c.Area);
        if (area is null) return null;
        var at = ParseTime(c.At) ?? now;

        if (area.Kind == "tasks")
        {
            var problems = new List<string>();
            var title = c.Task?.Title?.Trim() ?? "";
            if (title.Length == 0) problems.Add("The task needs a title.");
            var list = area.Lists.Any(l => l.Id == c.Task?.List) ? c.Task!.List : "personal";
            var task = new TaskProposal(title, list, ParseTime(c.Task?.DueAt)?.UtcDateTime, ParseTime(c.Task?.RemindAt)?.UtcDateTime);
            var listLabel = area.Lists.FirstOrDefault(l => l.Id == list)?.Label ?? list;
            return new Proposal("task", area.Id, area.Name, area.Icon, at.UtcDateTime, [], $"{listLabel}: {title}", task, problems.ToArray());
        }

        var raw = c.Fields.GroupBy(f => f.Key).ToDictionary(g => g.Key, g => (string?)g.Last().Value);
        return Entry(area, raw, at);
    }

    private Proposal Entry(AreaDefinition area, Dictionary<string, string?> raw, DateTimeOffset at)
    {
        var (data, problems) = catalog.Validate(area, raw);
        return new Proposal("entry", area.Id, area.Name, area.Icon, at.UtcDateTime, data, AreaCatalog.Summarize(area, data), null, problems.ToArray());
    }

    /// <summary>The fallback: each area's regex patterns. Used only when exactly one area matches.</summary>
    private CaptureResult WithPatterns(string text, DateTimeOffset now, string why)
    {
        var hits = new List<Proposal>();
        foreach (var area in catalog.Areas.Where(a => a.Kind == "log"))
        {
            foreach (var pattern in area.Patterns)
            {
                var m = Regex.Match(text, pattern, RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(200));
                if (!m.Success) continue;
                var raw = area.Fields.Where(f => m.Groups[f.Key].Success).ToDictionary(f => f.Key, f => (string?)m.Groups[f.Key].Value);
                hits.Add(Entry(area, raw, now));
                break;
            }
        }
        return hits.Count == 1
            ? new CaptureResult([.. hits], "patterns", why)
            : new CaptureResult([], "patterns", why + " This one needs the model.");
    }

    /// <summary>
    /// The areas folder as instructions. Built from files that change only on
    /// deploy, so it is identical across requests and in the same order every
    /// time.
    /// </summary>
    private string SystemPrompt()
    {
        var sb = new StringBuilder()
            .AppendLine("You read short captures for Bo, a personal tracking app, and turn them into structured records.")
            .AppendLine()
            .AppendLine(catalog.CaptureGuide)
            .AppendLine("# Areas");
        foreach (var a in catalog.Areas)
        {
            sb.AppendLine().AppendLine($"## {a.Name} — area id `{a.Id}`");
            if (a.Kind == "tasks")
                sb.AppendLine($"Kind: tasks. Fill `task`; leave `fields` empty. Lists: {string.Join(", ", a.Lists.Select(l => $"`{l.Id}` ({l.Label})"))}.");
            else
                foreach (var f in a.Fields)
                    sb.AppendLine($"- `{f.Key}` — {f.Label}, {f.Type}" +
                        (f.Unit is null ? "" : $" in {f.Unit}") +
                        (f.Options is null ? "" : $", one of: {string.Join(", ", f.Options)}") +
                        (f.Min is null ? "" : $", {f.Min}–{f.Max}") +
                        (f.Required ? ", required" : "") +
                        (f.Default is { } d ? $", default {d.GetRawText()}" : ""));
            sb.AppendLine().AppendLine(a.Guide);
        }
        return sb.ToString();
    }

    private Dictionary<string, JsonElement> Schema()
    {
        static object Nullable(object type) => new { anyOf = new[] { type, new { type = "null" } } };
        var schema = new
        {
            type = "object",
            additionalProperties = false,
            required = new[] { "captures", "note" },
            properties = new
            {
                captures = new
                {
                    type = "array",
                    items = new
                    {
                        type = "object",
                        additionalProperties = false,
                        required = new[] { "area", "at", "fields", "task" },
                        properties = new
                        {
                            area = new { type = "string", @enum = catalog.Areas.Select(a => a.Id).ToArray() },
                            at = Nullable(new { type = "string" }),
                            fields = new
                            {
                                type = "array",
                                items = new
                                {
                                    type = "object",
                                    additionalProperties = false,
                                    required = new[] { "key", "value" },
                                    properties = new { key = new { type = "string" }, value = new { type = "string" } },
                                },
                            },
                            task = Nullable(new
                            {
                                type = "object",
                                additionalProperties = false,
                                required = new[] { "title", "list", "dueAt", "remindAt" },
                                properties = new
                                {
                                    title = new { type = "string" },
                                    list = new { type = "string", @enum = catalog.Tasks.Lists.Select(l => l.Id).ToArray() },
                                    dueAt = Nullable(new { type = "string" }),
                                    remindAt = Nullable(new { type = "string" }),
                                },
                            }),
                        },
                    },
                },
                note = Nullable(new { type = "string" }),
            },
        };
        return JsonSerializer.SerializeToElement(schema).EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());
    }

    private static DateTimeOffset? ParseTime(string? s) =>
        DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t : null;

    private static TimeZoneInfo ZoneOf(string? id)
    {
        try { return id is { Length: > 0 } ? TimeZoneInfo.FindSystemTimeZoneById(id) : TimeZoneInfo.Utc; }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.Utc; }
    }

    private sealed record ModelOutput(ModelCapture[] Captures, string? Note);
    private sealed record ModelCapture(string Area, string? At, ModelField[] Fields, ModelTask? Task);
    private sealed record ModelField(string Key, string Value);
    private sealed record ModelTask(string? Title, string List, string? DueAt, string? RemindAt);
}
