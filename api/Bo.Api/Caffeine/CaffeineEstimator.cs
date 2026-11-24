using System.Diagnostics;
using System.Text.Json;
using Bo.Api.Ai;

namespace Bo.Api.Caffeine;

public sealed record CaffeineEstimate(int Mg, string Basis);

/// <summary>
/// How much caffeine a drink has, when it's logged without a number: the
/// owner's usual drinks from a table (no AI call), anything else estimated by
/// the model with a one-line basis. Each model call is recorded as feature
/// "caffeine" so it shows in AI usage.
/// </summary>
public sealed class CaffeineEstimator(IModelClient model, AiUsageStore usage, ILogger<CaffeineEstimator> log)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// His usual drinks, matched by any of the words. Typical published
    /// amounts; a number typed on the entry always wins.
    /// </summary>
    private static readonly (string[] Words, int Mg, string Basis)[] Known =
    [
        (["pike", "k-cup", "kcup", "k cup"], 130, "Starbucks Pike Place K-Cup, about 130 mg"),
        (["spark"], 120, "Advocare Spark, 120 mg a stick"),
        (["celsius"], 200, "Celsius, 200 mg a 12 oz can"),
    ];

    public static CaffeineEstimate? FromTable(string drink)
    {
        var d = drink.ToLowerInvariant();
        foreach (var (words, mg, basis) in Known)
            if (words.Any(d.Contains)) return new(mg, basis);
        return null;
    }

    public async Task<CaffeineEstimate?> EstimateAsync(Guid user, string drink, CancellationToken ct)
    {
        if (FromTable(drink) is { } known) return known;
        if (!model.Configured) return null;
        var clock = Stopwatch.StartNew();
        var request = new ModelRequest(System, $"Drink: {drink}", Schema(), "low");
        try
        {
            var reply = await model.CompleteJsonAsync(request, ct);
            var cost = usage.Options.CostOf(model.Provider, model.Model, reply.Usage);
            var output = reply.Stop == ModelStop.Done ? JsonSerializer.Deserialize<Output>(reply.Text, Json) : null;
            var ok = output is { Mg: >= 0 and <= 1000 };
            await usage.RecordAsync(new AiCall(user, "caffeine", model.Provider, model.Model, ok ? "ok" : "unparsed", "model", reply.Usage, cost,
                (int)clock.ElapsedMilliseconds, 0, drink, "typed", request.User, reply.Text, null, ok ? $"{output!.Mg} mg" : null, null), ct);
            return ok ? new CaffeineEstimate(output!.Mg, $"est. {output.Basis?.Trim()}".TrimEnd()) : null;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "Caffeine estimate failed.");
            return null;
        }
    }

    private sealed record Output(int Mg, string? Basis);

    private const string System = """
        Estimate the caffeine in one drink, in milligrams, as typically served.
        Use the size if given; otherwise assume the usual serving (a 12 oz can,
        a grande at a coffee shop, an 8 oz cup brewed at home). Decaf is about
        5 mg; caffeine-free is 0. Give one whole number and a short basis naming
        the serving you assumed, e.g. "grande (16 oz) cold brew, ~205 mg".
        """;

    private static Dictionary<string, JsonElement> Schema() =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(new
        {
            type = "object",
            additionalProperties = false,
            required = new[] { "mg", "basis" },
            properties = new { mg = new { type = "integer" }, basis = new { type = "string" } },
        }))!;
}
