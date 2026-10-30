using System.Text.Json;

namespace Bo.Api.Areas;

/// <summary>One <c>areas/&lt;id&gt;/area.json</c>, plus its README as <see cref="Guide"/>.</summary>
public sealed record AreaDefinition
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string Icon { get; init; } = "ellipse-outline";
    /// <summary>"log" (entries) or "tasks".</summary>
    public string Kind { get; init; } = "log";
    public AreaField[] Fields { get; init; } = [];
    public AreaList[] Lists { get; init; } = [];
    public string Summary { get; init; } = "";
    public string[] Patterns { get; init; } = [];
    /// <summary>The folder's README.md, verbatim. Read by the capture parser and shown in the app.</summary>
    public string Guide { get; init; } = "";
}

public sealed record AreaField
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    /// <summary>integer | number | text | choice | boolean</summary>
    public required string Type { get; init; }
    public string? Unit { get; init; }
    public decimal? Min { get; init; }
    public decimal? Max { get; init; }
    public string[]? Options { get; init; }
    public string? TrueLabel { get; init; }
    public string? FalseLabel { get; init; }
    public JsonElement? Default { get; init; }
    public bool Required { get; init; }
}

public sealed record AreaList(string Id, string Label);
