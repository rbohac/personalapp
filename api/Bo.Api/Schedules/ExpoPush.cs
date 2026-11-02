using System.Net.Http.Json;
using Bo.Api.Data;
using Dapper;
using Npgsql;

namespace Bo.Api.Schedules;

public record PushMessage(string Title, string Body, object Data, string? CategoryId = null);

/// <summary>What happened to one push: <see cref="Outcome"/> is sent, delivered, failed, no-devices or disabled.</summary>
public record PushResult(Guid LogId, string Outcome, string? Detail, int Devices);

/// <summary>
/// Sends a push through Expo's push service to every phone a person has
/// registered, and records each attempt in push_log so the phone can show
/// what happened. A token Expo calls gone is removed. Expo answers in two
/// steps — a ticket now, a receipt a little later once Apple has the push —
/// so <see cref="CheckReceiptsAsync"/> fills in the second half. With
/// <c>Push:Enabled</c> false (local runs) it logs instead of sending.
/// </summary>
public sealed class ExpoPush(HttpClient http, Db db, IConfiguration config, ILogger<ExpoPush> log)
{
    private const string Api = "https://exp.host/--/api/v2/push";
    private readonly bool _enabled = config.GetValue("Push:Enabled", true);

    private sealed record Ticket(string Status, string? Id, string? Message, Details? Details);
    private sealed record Details(string? Error);
    private sealed record TicketResponse(Ticket[]? Data);
    private sealed record Receipt(string Status, string? Message, Details? Details);
    private sealed record ReceiptResponse(Dictionary<string, Receipt>? Data);

    public async Task<PushResult> SendAsync(Guid user, PushMessage m, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var tokens = (await conn.QueryAsync<string>("select expo_token from push_devices where user_id = @user", new { user })).ToList();
        if (tokens.Count == 0) return await RecordAsync(conn, user, m, 0, "no-devices", "No phone is registered for push.", []);
        if (!_enabled)
        {
            log.LogInformation("Push (disabled) to {Count} device(s): {Title} — {Body}", tokens.Count, m.Title, m.Body);
            return await RecordAsync(conn, user, m, tokens.Count, "disabled", null, []);
        }

        var messages = tokens.Select(t => new
        {
            to = t, title = m.Title, body = m.Body, data = m.Data, sound = "default", categoryId = m.CategoryId, priority = "high",
        }).ToArray();
        HttpResponseMessage res;
        try { res = await http.PostAsJsonAsync($"{Api}/send", messages, ct); }
        catch (HttpRequestException e) { return await RecordAsync(conn, user, m, tokens.Count, "failed", $"Couldn't reach Expo: {e.Message}", []); }
        using (res)
        {
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(ct);
                log.LogWarning("Expo push answered {Status}: {Body}", (int)res.StatusCode, body);
                return await RecordAsync(conn, user, m, tokens.Count, "failed", $"Expo answered {(int)res.StatusCode}: {Trim(body)}", []);
            }
            var tickets = (await res.Content.ReadFromJsonAsync<TicketResponse>(ct))?.Data ?? [];
            var errors = new List<string>();
            var gone = new List<string>();
            for (var i = 0; i < tickets.Length && i < tokens.Count; i++)
            {
                if (tickets[i].Status == "ok") continue;
                var error = tickets[i].Details?.Error;
                log.LogWarning("Expo refused a push: {Message} ({Error})", tickets[i].Message, error);
                errors.Add($"{error ?? "error"}: {tickets[i].Message}");
                if (error == "DeviceNotRegistered") gone.Add(tokens[i]);
            }
            if (gone.Count > 0) await conn.ExecuteAsync("delete from push_devices where expo_token = any(@gone)", new { gone });
            var ids = tickets.Where(t => t.Status == "ok" && t.Id is not null).Select(t => t.Id!).ToArray();
            log.LogInformation("Push \"{Title}\": {Ok} of {Count} accepted by Expo", m.Title, ids.Length, tokens.Count);
            return ids.Length > 0
                ? await RecordAsync(conn, user, m, tokens.Count, "sent", errors.Count > 0 ? string.Join("; ", errors) : null, ids)
                : await RecordAsync(conn, user, m, tokens.Count, "failed", string.Join("; ", errors), []);
        }
    }

    /// <summary>
    /// Ask Expo what became of pushes it accepted: delivered to Apple, or
    /// refused (bad credentials, a dead token). Updates push_log.
    /// <paramref name="only"/> narrows it to one push (the test button).
    /// </summary>
    public async Task CheckReceiptsAsync(CancellationToken ct, Guid? only = null)
    {
        if (!_enabled) return;
        await using var conn = await db.OpenAsync(ct);
        var pending = (await conn.QueryAsync<(Guid Id, string[] TicketIds)>(
            """
            select id, ticket_ids from push_log
            where outcome = 'sent' and at < now() - interval '2 seconds' and at > now() - interval '1 day'
              and (@only::uuid is null or id = @only)
            """, new { only })).ToList();
        if (pending.Count == 0) return;
        var ids = pending.SelectMany(p => p.TicketIds).Distinct().ToArray();
        using var res = await http.PostAsJsonAsync($"{Api}/getReceipts", new { ids }, ct);
        if (!res.IsSuccessStatusCode) return;
        var receipts = (await res.Content.ReadFromJsonAsync<ReceiptResponse>(ct))?.Data ?? [];
        foreach (var p in pending)
        {
            var mine = p.TicketIds.Select(t => receipts.GetValueOrDefault(t)).ToList();
            if (mine.Any(r => r is null)) continue; // not ready yet
            var failed = mine.Where(r => r!.Status != "ok").ToList();
            var outcome = failed.Count == mine.Count ? "failed" : "delivered";
            var detail = failed.Count > 0 ? string.Join("; ", failed.Select(r => $"{r!.Details?.Error ?? "error"}: {r.Message}")) : null;
            if (failed.Count > 0) log.LogWarning("Push receipt errors: {Detail}", detail);
            await conn.ExecuteAsync("update push_log set outcome = @outcome, detail = coalesce(@detail, detail) where id = @id",
                new { p.Id, outcome, detail });
        }
    }

    public Task<int> PruneAsync(NpgsqlConnection conn) =>
        conn.ExecuteAsync("delete from push_log where at < now() - interval '30 days'");

    private static async Task<PushResult> RecordAsync(NpgsqlConnection conn, Guid user, PushMessage m, int devices, string outcome, string? detail, string[] ids)
    {
        var id = await conn.ExecuteScalarAsync<Guid>(
            "insert into push_log (user_id, title, devices, outcome, detail, ticket_ids) values (@user, @title, @devices, @outcome, @detail, @ids) returning id",
            new { user, title = m.Title, devices, outcome, detail, ids });
        return new PushResult(id, outcome, detail, devices);
    }

    private static string Trim(string s) => s.Length > 300 ? s[..300] : s;
}
