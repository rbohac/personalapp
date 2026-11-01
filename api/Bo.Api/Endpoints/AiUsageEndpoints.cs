using System.Text.Json;
using Bo.Api.Ai;
using Bo.Api.Auth;
using Bo.Api.Data;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

public record UsageMonth(
    DateOnly Start, decimal Spend, decimal Budget, decimal Projected,
    int Calls, int ModelCalls, int Fallbacks, int UnknownCostCalls, int Proposals, int Kept);
public record UsageBucket(DateOnly Start, decimal Cost, int Calls);
public record UsageByModel(string Provider, string Model, int Calls, decimal? Cost, long InputTokens, long OutputTokens);
public record UsageSummary(UsageMonth Month, UsageBucket[] Days, UsageBucket[] Weeks, UsageByModel[] Models, int LogRetentionDays);

public record AiCallDto(
    Guid Id, DateTime At, string Feature, string? Provider, string? Model, string Outcome, string Parser,
    int InputTokens, int OutputTokens, int CacheReadTokens, int CacheWriteTokens, decimal? CostUsd,
    int? LatencyMs, int Proposals, int Kept, string? Input);
public record AiLogDto(string Input, string? Source, string? Request, string? Response, JsonElement? Proposals, string? Note, string? Error);
public record AiCallDetail(AiCallDto Call, AiLogDto? Log);

/// <summary>
/// Model usage and cost: a monthly view against the budget, daily and weekly
/// series to chart, and the calls behind them down to the words (while their
/// logs are kept). Days and weeks are cut in the caller's time zone.
/// </summary>
public static class AiUsageEndpoints
{
    // Kept = entries plus tasks saved from the call's proposals.
    private const string CallColumns =
        """
        u.id, u.at, u.feature, u.provider, u.model, u.outcome, u.parser,
        u.input_tokens as inputtokens, u.output_tokens as outputtokens,
        u.cache_read_tokens as cachereadtokens, u.cache_write_tokens as cachewritetokens,
        u.cost_usd as costusd, u.latency_ms as latencyms, u.proposals,
        ((select count(*) from entries e where e.ai_usage_id = u.id) + (select count(*) from tasks t where t.ai_usage_id = u.id))::int as kept,
        l.input
        """;

    public static void MapAiUsageEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/ai/usage").WithTags("AI usage").RequireAuthorization();
        g.MapGet("/summary", Summary);
        g.MapGet("/calls", Calls);
        g.MapGet("/calls/{id:guid}", Call);
    }

    /// <summary><c>tz</c> is the IANA time zone days are cut in; <c>days</c> (≤ 90) and <c>weeks</c> (≤ 52) size the series.</summary>
    private static async Task<Ok<UsageSummary>> Summary(
        HttpContext http, Db db, AiUsageStore store, CancellationToken ct, string tz = "UTC", int days = 30, int weeks = 12)
    {
        tz = SafeZone(tz);
        days = Math.Clamp(days, 7, 90);
        weeks = Math.Clamp(weeks, 4, 52);
        var user = http.User.UserId();
        await using var conn = await db.OpenAsync(ct);

        var m = await conn.QuerySingleAsync<(DateTime Start, decimal Spend, int Calls, int ModelCalls, int Fallbacks, int Unknown, int Proposals, int Kept, int DayOfMonth, int DaysInMonth)>(
            """
            with bounds as (select date_trunc('month', now() at time zone @tz) as start)
            select b.start,
                   coalesce(sum(u.cost_usd), 0),
                   count(u.id)::int,
                   count(u.id) filter (where u.provider is not null)::int,
                   count(u.id) filter (where u.parser = 'patterns')::int,
                   count(u.id) filter (where u.provider is not null and u.cost_usd is null)::int,
                   coalesce(sum(u.proposals), 0)::int,
                   coalesce(sum((select count(*) from entries e where e.ai_usage_id = u.id)
                              + (select count(*) from tasks t where t.ai_usage_id = u.id)), 0)::int,
                   extract(day from now() at time zone @tz)::int,
                   extract(day from (b.start + interval '1 month - 1 day'))::int
            from bounds b
            left join ai_usage u on u.user_id = @user and (u.at at time zone @tz) >= b.start
            group by b.start
            """, new { user, tz });

        // Straight-line projection of this month's spend from the days so far.
        var projected = Math.Round(m.Spend / Math.Max(1, m.DayOfMonth) * m.DaysInMonth, 4);
        var month = new UsageMonth(DateOnly.FromDateTime(m.Start), m.Spend, store.Options.MonthlyBudgetUsd, projected,
            m.Calls, m.ModelCalls, m.Fallbacks, m.Unknown, m.Proposals, m.Kept);

        var dayRows = await conn.QueryAsync<(DateTime Start, decimal Cost, int Calls)>(
            """
            select d.day, coalesce(sum(u.cost_usd), 0), count(u.id)::int
            from generate_series((now() at time zone @tz)::date - (@days - 1), (now() at time zone @tz)::date, interval '1 day') as d(day)
            left join ai_usage u on u.user_id = @user and (u.at at time zone @tz)::date = d.day::date
            group by d.day order by d.day
            """, new { user, tz, days });

        var weekRows = await conn.QueryAsync<(DateTime Start, decimal Cost, int Calls)>(
            """
            with this_week as (select date_trunc('week', now() at time zone @tz)::date as start)
            select w.week, coalesce(sum(u.cost_usd), 0), count(u.id)::int
            from this_week, generate_series(this_week.start - 7 * (@weeks - 1), this_week.start, interval '7 days') as w(week)
            left join ai_usage u on u.user_id = @user
              and date_trunc('week', u.at at time zone @tz)::date = w.week::date
            group by w.week order by w.week
            """, new { user, tz, weeks });

        // A model with any unpriced call shows its cost as unknown rather than a misleading partial sum.
        var models = await conn.QueryAsync<UsageByModel>(
            """
            select provider, model, count(*)::int as calls,
                   case when bool_or(cost_usd is null) then null else sum(cost_usd) end as cost,
                   sum(input_tokens)::bigint as inputtokens, sum(output_tokens)::bigint as outputtokens
            from ai_usage
            where user_id = @user and provider is not null
              and (at at time zone @tz) >= date_trunc('month', now() at time zone @tz)
            group by provider, model order by calls desc
            """, new { user, tz });

        return TypedResults.Ok(new UsageSummary(
            month,
            dayRows.Select(r => new UsageBucket(DateOnly.FromDateTime(r.Start), r.Cost, r.Calls)).ToArray(),
            weekRows.Select(r => new UsageBucket(DateOnly.FromDateTime(r.Start), r.Cost, r.Calls)).ToArray(),
            models.ToArray(),
            store.Options.LogRetentionDays));
    }

    /// <summary>Newest first. <c>day</c> (yyyy-MM-dd, in <c>tz</c>) narrows to one day — what tapping a bar asks for.</summary>
    private static async Task<Ok<AiCallDto[]>> Calls(
        HttpContext http, Db db, CancellationToken ct, string tz = "UTC", DateOnly? day = null, int limit = 50)
    {
        tz = SafeZone(tz);
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<AiCallDto>(
            $"""
            select {CallColumns}
            from ai_usage u left join ai_logs l on l.usage_id = u.id
            where u.user_id = @user and (@day::date is null or (u.at at time zone @tz)::date = @day::date)
            order by u.at desc limit @limit
            """,
            new { user = http.User.UserId(), tz, day = day?.ToDateTime(TimeOnly.MinValue), limit = Math.Clamp(limit, 1, 200) });
        return TypedResults.Ok(rows.ToArray());
    }

    /// <summary>One call with its log. <c>Log</c> is null once the words are past the retention window.</summary>
    private static async Task<Results<Ok<AiCallDetail>, NotFound>> Call(Guid id, HttpContext http, Db db, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var call = await conn.QuerySingleOrDefaultAsync<AiCallDto>(
            $"select {CallColumns} from ai_usage u left join ai_logs l on l.usage_id = u.id where u.id = @id and u.user_id = @user",
            new { id, user = http.User.UserId() });
        if (call is null) return TypedResults.NotFound();

        var log = await conn.QuerySingleOrDefaultAsync<(string Input, string? Source, string? Request, string? Response, string? Proposals, string? Note, string? Error)?>(
            "select input, source, request, response, proposals::text, note, error from ai_logs where usage_id = @id", new { id });
        AiLogDto? logDto = log is { } l
            ? new AiLogDto(l.Input, l.Source, l.Request, l.Response,
                l.Proposals is null ? null : JsonSerializer.Deserialize<JsonElement>(l.Proposals), l.Note, l.Error)
            : null;
        return TypedResults.Ok(new AiCallDetail(call, logDto));
    }

    /// <summary>Only a time zone Postgres knows gets near the SQL; anything else is UTC.</summary>
    private static string SafeZone(string tz)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(tz).Id; }
        catch { return "UTC"; }
    }
}
