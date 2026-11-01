using Anthropic;
using Anthropic.Models.Messages;

namespace Bo.Api.Ai;

/// <summary>Claude, through Anthropic's official C# SDK.</summary>
public sealed class AnthropicModelClient(string? apiKey, string model) : IModelClient
{
    private AnthropicClient? _client;

    public string Provider => "anthropic";
    public string Model => model;
    public bool Configured => !string.IsNullOrEmpty(apiKey);

    public async Task<ModelReply> CompleteJsonAsync(ModelRequest request, CancellationToken ct)
    {
        _client ??= new AnthropicClient { ApiKey = apiKey };

        // No temperature (Claude Haiku 5.5 rejects sampling parameters) and no
        // prefill: the JSON shape comes from structured output. MaxTokens
        // leaves room for thinking, which counts against it.
        var response = await _client.Messages.Create(new MessageCreateParams
        {
            Model = model,
            MaxTokens = 16000,
            System = request.System,
            OutputConfig = new OutputConfig { Effort = request.Effort, Format = new JsonOutputFormat { Schema = request.JsonSchema } },
            Messages = [new UserMessageParam { Content = request.User }],
        }, cancellationToken: ct);

        var stop = response.StopReason == "refusal" ? ModelStop.Refused
            : response.StopReason == "max_tokens" ? ModelStop.OutOfRoom
            : ModelStop.Done;

        // Thinking blocks can come first; read the answer by type, not position.
        var text = string.Concat(response.Content.Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text));

        var u = response.Usage;
        return new ModelReply(text, stop, new ModelUsage(
            u.InputTokens, u.OutputTokens, u.CacheReadInputTokens ?? 0, u.CacheCreationInputTokens ?? 0));
    }
}
