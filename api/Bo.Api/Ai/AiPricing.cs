namespace Bo.Api.Ai;

/// <summary>Price per million tokens for one provider/model, from appsettings "Ai:Prices".</summary>
public sealed class ModelPrice
{
    public decimal Input { get; set; }
    public decimal Output { get; set; }
    public decimal CacheRead { get; set; }
    public decimal CacheWrite { get; set; }
}

public sealed class AiOptions
{
    /// <summary>Monthly spend limit across all model calls. Past it, features fall back instead of calling.</summary>
    public decimal MonthlyBudgetUsd { get; set; } = 5m;
    /// <summary>How long the words (prompts, inputs, answers) are kept. Usage and cost are kept forever.</summary>
    public int LogRetentionDays { get; set; } = 30;
    /// <summary>Keyed "provider/model", e.g. "anthropic/claude-haiku-5-5".</summary>
    public Dictionary<string, ModelPrice> Prices { get; set; } = [];

    /// <summary>
    /// Dollar cost of a call, or null when the model has no price entry. Null
    /// means "unknown", never "free": a missing price must show up, not hide.
    /// </summary>
    public decimal? CostOf(string provider, string model, ModelUsage u) =>
        Prices.TryGetValue($"{provider}/{model}", out var p)
            ? Math.Round((u.InputTokens * p.Input + u.OutputTokens * p.Output
                + u.CacheReadTokens * p.CacheRead + u.CacheWriteTokens * p.CacheWrite) / 1_000_000m, 6)
            : null;
}
