using System.Text.Json;
using Bo.Api.Data;
using Dapper;
using Microsoft.Extensions.Options;

namespace Bo.Api.Ai;

/// <summary>One finished model call (or a call that was skipped), ready to record.</summary>
public sealed record AiCall(
    Guid UserId, string Feature, string? Provider, string? Model, string Outcome, string Parser,
    ModelUsage Usage, decimal? CostUsd, int? LatencyMs, int Proposals,
    string Input, string? Source, string? Request, string? Response, object? ProposalsJson, string? Note, string? Error);

public sealed class AiUsageStore(Db db, IOptions<AiOptions> options, ILogger<AiUsageStore> log)
{
    public AiOptions Options => options.Value;

    /// <summary>Records a call: the usage row (kept forever) and its log (kept for the retention window), together.</summary>
    public async Task<Guid> RecordAsync(AiCall c, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var id = await conn.QuerySingleAsync<Guid>(
            """
            insert into ai_usage (user_id, feature, provider, model, outcome, parser,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, proposals)
            values (@UserId, @Feature, @Provider, @Model, @Outcome, @Parser,
              @In, @Out, @CacheRead, @CacheWrite, @CostUsd, @LatencyMs, @Proposals)
            returning id
            """,
            new
            {
                c.UserId, c.Feature, c.Provider, c.Model, c.Outcome, c.Parser,
                In = (int)c.Usage.InputTokens, Out = (int)c.Usage.OutputTokens,
                CacheRead = (int)c.Usage.CacheReadTokens, CacheWrite = (int)c.Usage.CacheWriteTokens,
                c.CostUsd, c.LatencyMs, c.Proposals,
            }, tx);
        await conn.ExecuteAsync(
            """
            insert into ai_logs (usage_id, at, input, source, request, response, proposals, note, error)
            values (@id, now(), @Input, @Source, @Request, @Response, @ProposalsJson::jsonb, @Note, @Error)
            """,
            new
            {
                id, c.Input, c.Source, c.Request, c.Response, c.Note, c.Error,
                ProposalsJson = c.ProposalsJson is null ? null : JsonSerializer.Serialize(c.ProposalsJson, JsonSerializerOptions.Web),
            }, tx);
        await tx.CommitAsync(ct);

        // One line per call in `fly logs`, without the words.
        log.LogInformation("AI {Feature}: {Provider}/{Model} {Outcome} via {Parser} in {LatencyMs} ms, tokens {In}/{Out}, cost {Cost}",
            c.Feature, c.Provider ?? "-", c.Model ?? "-", c.Outcome, c.Parser, c.LatencyMs, c.Usage.InputTokens, c.Usage.OutputTokens,
            c.CostUsd is { } cost ? $"${cost:0.000000}" : "unknown");
        return id;
    }

    /// <summary>Spend so far this calendar month, in the user's time zone.</summary>
    public async Task<decimal> MonthSpendAsync(Guid userId, string timeZone, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.QuerySingleAsync<decimal>(
            """
            select coalesce(sum(cost_usd), 0) from ai_usage
            where user_id = @userId
              and (at at time zone @tz) >= date_trunc('month', now() at time zone @tz)
            """,
            new { userId, tz = timeZone });
    }

    /// <summary>Deletes logs (the words) past the retention window. Usage rows stay.</summary>
    /// <summary>Idempotency keys only need to outlive a retry; a week is plenty.</summary>
    public async Task PurgeIdempotencyAsync(CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await conn.ExecuteAsync("delete from idempotency_keys where created_at < now() - interval '7 days'");
    }

    public async Task<int> PurgeLogsAsync(CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await conn.ExecuteAsync("delete from ai_logs where at < now() - make_interval(days => @days)",
            new { days = Options.LogRetentionDays });
    }
}

/// <summary>Runs the log purge at startup and every six hours. The Fly machine is always on, so no cron is needed.</summary>
public sealed class AiLogRetention(AiUsageStore store, ILogger<AiLogRetention> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(6));
        do
        {
            try
            {
                var n = await store.PurgeLogsAsync(stoppingToken);
                await store.PurgeIdempotencyAsync(stoppingToken);
                if (n > 0) log.LogInformation("Deleted {Count} AI log(s) older than {Days} days.", n, store.Options.LogRetentionDays);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning(e, "AI log purge failed; will retry.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
