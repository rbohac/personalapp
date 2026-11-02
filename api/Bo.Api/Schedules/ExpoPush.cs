using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Bo.Api.Schedules;

public record PushMessage(string Title, string Body, object Data, string? CategoryId = null);

/// <summary>
/// Sends a push through Expo's push service to every phone a person has
/// registered (push_devices). A token Expo says is gone is removed. With
/// <c>Push:Enabled</c> false (local runs) it logs the message instead.
/// </summary>
public sealed class ExpoPush(HttpClient http, IConfiguration config, ILogger<ExpoPush> log)
{
    private readonly bool _enabled = config.GetValue("Push:Enabled", true);

    public sealed record Ticket(string Status, string? Message, TicketDetails? Details);
    public sealed record TicketDetails(string? Error);
    private sealed record Response(Ticket[]? Data);

    /// <returns>Tokens Expo reported as no longer registered.</returns>
    public async Task<string[]> SendAsync(IReadOnlyList<string> tokens, PushMessage m, CancellationToken ct)
    {
        if (tokens.Count == 0) return [];
        if (!_enabled)
        {
            log.LogInformation("Push (disabled) to {Count} device(s): {Title} — {Body}", tokens.Count, m.Title, m.Body);
            return [];
        }
        var messages = tokens.Select(t => new
        {
            to = t, title = m.Title, body = m.Body, data = m.Data, sound = "default",
            categoryId = m.CategoryId, priority = "high",
        }).ToArray();
        using var res = await http.PostAsJsonAsync("https://exp.host/--/api/v2/push/send", messages, ct);
        if (!res.IsSuccessStatusCode)
        {
            log.LogWarning("Expo push answered {Status}: {Body}", (int)res.StatusCode, await res.Content.ReadAsStringAsync(ct));
            return [];
        }
        var tickets = (await res.Content.ReadFromJsonAsync<Response>(ct))?.Data ?? [];
        var gone = new List<string>();
        for (var i = 0; i < tickets.Length && i < tokens.Count; i++)
        {
            if (tickets[i].Status == "ok") continue;
            log.LogWarning("Expo push to a device failed: {Message} ({Error})", tickets[i].Message, tickets[i].Details?.Error);
            if (tickets[i].Details?.Error == "DeviceNotRegistered") gone.Add(tokens[i]);
        }
        return [.. gone];
    }
}
