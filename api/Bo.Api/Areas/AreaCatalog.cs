using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Bo.Api.Areas;

/// <summary>
/// The areas folder, loaded once at startup. It is the single definition of
/// what each area records: the API validates against it, renders summaries
/// from it, serves it to the app, and hands it to the capture parser. A bad
/// area.json stops the API from starting, so a typo surfaces in the deploy
/// rather than as entries that silently don't validate.
/// </summary>
public sealed class AreaCatalog
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] FieldTypes = ["integer", "number", "text", "choice", "boolean"];

    public IReadOnlyList<AreaDefinition> Areas { get; }
    /// <summary>areas/_capture.md — the parser's general rules.</summary>
    public string CaptureGuide { get; }

    private readonly Dictionary<string, AreaDefinition> _byId;

    private AreaCatalog(List<AreaDefinition> areas, string captureGuide)
    {
        Areas = areas;
        CaptureGuide = captureGuide;
        _byId = areas.ToDictionary(a => a.Id);
    }

    public AreaDefinition? Find(string id) => _byId.GetValueOrDefault(id);

    public AreaDefinition Tasks => Areas.First(a => a.Kind == "tasks");

    public static AreaCatalog Load(string dir)
    {
        var areas = new List<AreaDefinition>();
        foreach (var folder in Directory.GetDirectories(dir).Order())
        {
            var file = Path.Combine(folder, "area.json");
            if (!File.Exists(file)) continue;
            var id = Path.GetFileName(folder);
            var area = JsonSerializer.Deserialize<AreaDefinition>(File.ReadAllText(file), Json)
                ?? throw new InvalidOperationException($"{file} is empty.");
            if (area.Id != id) throw new InvalidOperationException($"{file}: id \"{area.Id}\" must equal the folder name \"{id}\".");
            foreach (var f in area.Fields)
            {
                if (!FieldTypes.Contains(f.Type)) throw new InvalidOperationException($"{file}: field {f.Key} has unknown type \"{f.Type}\".");
                if (f.Type == "choice" && f.Options is not { Length: > 0 }) throw new InvalidOperationException($"{file}: choice field {f.Key} needs options.");
            }
            foreach (var p in area.Patterns) _ = new Regex(p); // a bad pattern fails here, at startup
            var readme = Path.Combine(folder, "README.md");
            areas.Add(area with { Guide = File.Exists(readme) ? File.ReadAllText(readme) : "" });
        }
        if (areas.Count(a => a.Kind == "tasks") != 1) throw new InvalidOperationException($"{dir}: exactly one area must have kind \"tasks\".");

        var capture = Path.Combine(dir, "_capture.md");
        return new AreaCatalog(areas, File.Exists(capture) ? File.ReadAllText(capture) : "");
    }

    /// <summary>
    /// The areas folder: <c>Areas:Path</c> if set, else the first <c>areas/</c>
    /// found walking up from the app's directory — /app/areas in the container,
    /// the repo root's areas/ when running from a checkout.
    /// </summary>
    public static string FindDirectory(IConfiguration config, string contentRoot)
    {
        if (config["Areas:Path"] is { Length: > 0 } configured) return configured;
        foreach (var start in new[] { AppContext.BaseDirectory, contentRoot })
        {
            for (var d = new DirectoryInfo(start); d is not null; d = d.Parent)
            {
                var candidate = Path.Combine(d.FullName, "areas");
                if (File.Exists(Path.Combine(candidate, "README.md"))) return candidate;
            }
        }
        throw new InvalidOperationException("No areas/ folder found. Set Areas:Path.");
    }

    /// <summary>
    /// Check and normalize an entry's values against its area. Values arrive
    /// as strings (from the model) or JSON (from the app); both are coerced to
    /// the field's type. Problems are reasons the entry can't be saved as is.
    /// </summary>
    public (Dictionary<string, object?> Data, List<string> Problems) Validate(AreaDefinition area, IReadOnlyDictionary<string, string?> raw)
    {
        var data = new Dictionary<string, object?>();
        var problems = new List<string>();

        foreach (var key in raw.Keys.Where(k => area.Fields.All(f => f.Key != k)))
            problems.Add($"{area.Name} has no field \"{key}\".");

        foreach (var f in area.Fields)
        {
            var text = raw.GetValueOrDefault(f.Key)?.Trim();
            if (string.IsNullOrEmpty(text) && f.Default is { } d) text = d.ValueKind == JsonValueKind.String ? d.GetString() : d.GetRawText();
            if (string.IsNullOrEmpty(text))
            {
                if (f.Required) problems.Add($"{f.Label} is missing.");
                continue;
            }

            object? value = null;
            string? problem = null;
            switch (f.Type)
            {
                case "integer":
                case "number":
                    if (!decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var n)) problem = $"{f.Label} \"{text}\" isn't a number.";
                    else if (f.Type == "integer" && n != decimal.Truncate(n)) problem = $"{f.Label} should be a whole number.";
                    else if (n < f.Min || n > f.Max) problem = $"{f.Label} {n} is outside {f.Min}–{f.Max}{(f.Unit is null ? "" : " " + f.Unit)}.";
                    else value = f.Type == "integer" ? (long)n : n;
                    break;
                case "boolean":
                    value = text.ToLowerInvariant() switch { "true" or "yes" or "1" => true, "false" or "no" or "0" => false, _ => null };
                    if (value is null) problem = $"{f.Label} should be yes or no.";
                    break;
                case "choice":
                    var choice = text.ToLowerInvariant().Replace(' ', '-');
                    if (f.Options!.Contains(choice)) value = choice;
                    else problem = $"{f.Label} \"{text}\" isn't one of: {string.Join(", ", f.Options!)}.";
                    break;
                default:
                    value = text.Length > 2000 ? text[..2000] : text;
                    break;
            }
            if (problem is not null) problems.Add(problem);
            else data[f.Key] = value;
        }
        return (data, problems);
    }

    /// <summary>JSON values from the app, flattened to the strings Validate reads.</summary>
    public static Dictionary<string, string?> FromJson(IReadOnlyDictionary<string, JsonElement> values) =>
        values.ToDictionary(kv => kv.Key, kv => kv.Value.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => kv.Value.GetString(),
            _ => kv.Value.GetRawText(),
        });

    /// <summary>
    /// How an entry reads in a list, from the area's summary template:
    /// segments split on " · ", and a segment naming a field with no value is
    /// dropped, so "{systolic}/{diastolic} · pulse {pulse}" reads "120/80"
    /// when no pulse was given.
    /// </summary>
    public static string Summarize(AreaDefinition area, IReadOnlyDictionary<string, object?> data)
    {
        var parts = new List<string>();
        foreach (var segment in area.Summary.Split(" · ", StringSplitOptions.RemoveEmptyEntries))
        {
            var missing = false;
            var rendered = Regex.Replace(segment, @"\{(\w+)\}", m =>
            {
                var f = area.Fields.FirstOrDefault(x => x.Key == m.Groups[1].Value);
                var v = data.GetValueOrDefault(m.Groups[1].Value);
                if (f is null || v is null) { missing = true; return ""; }
                return Display(f, v);
            });
            if (!missing) parts.Add(rendered);
        }
        if (parts.Count == 0) return area.Name;
        var text = string.Join(" · ", parts);
        return char.ToUpperInvariant(text[0]) + text[1..];
    }

    private static string Display(AreaField f, object v) => v switch
    {
        bool b => b ? f.TrueLabel ?? "Yes" : f.FalseLabel ?? "No",
        decimal d => d.ToString("0.##", CultureInfo.InvariantCulture),
        JsonElement { ValueKind: JsonValueKind.True } => f.TrueLabel ?? "Yes",
        JsonElement { ValueKind: JsonValueKind.False } => f.FalseLabel ?? "No",
        JsonElement { ValueKind: JsonValueKind.Number } j => j.GetDecimal().ToString("0.##", CultureInfo.InvariantCulture),
        JsonElement j => (j.GetString() ?? "").Replace('-', ' '),
        string s => f.Type == "choice" ? s.Replace('-', ' ') : s,
        _ => Convert.ToString(v, CultureInfo.InvariantCulture) ?? "",
    };
}
