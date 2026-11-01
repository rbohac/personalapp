using System.Text.Json;

namespace Bo.Api.Ai;

/// <summary>
/// One call to a language model that must answer in a given JSON shape. The
/// app talks to models only through <see cref="IModelClient"/>, so adding a
/// provider (OpenAI, a local open-source model) is a new implementation and a
/// price-table entry; nothing that records or reports usage changes.
/// </summary>
public sealed record ModelRequest(string System, string User, Dictionary<string, JsonElement> JsonSchema, string Effort);

/// <summary>How the model stopped, in provider-neutral words.</summary>
public enum ModelStop
{
    /// <summary>Finished normally.</summary>
    Done,
    /// <summary>Declined to answer (a provider's safety system).</summary>
    Refused,
    /// <summary>Hit the output limit before finishing.</summary>
    OutOfRoom,
}

public sealed record ModelUsage(long InputTokens, long OutputTokens, long CacheReadTokens, long CacheWriteTokens);

public sealed record ModelReply(string Text, ModelStop Stop, ModelUsage Usage);

public interface IModelClient
{
    /// <summary>Lowercase provider id: "anthropic", later "openai", "ollama", …</summary>
    string Provider { get; }
    string Model { get; }
    /// <summary>False when the provider has no credentials; callers fall back instead of calling.</summary>
    bool Configured { get; }
    Task<ModelReply> CompleteJsonAsync(ModelRequest request, CancellationToken ct);
}
