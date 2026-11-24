using System.Text.Json;
using Bo.Api.Areas;
using Bo.Api.Auth;
using Bo.Api.Data;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

public record EntryDto(
    Guid Id, string Area, DateTime At, Dictionary<string, JsonElement> Data, string Summary,
    string Source, string? Raw, DateTime CreatedAt);

/// <summary>A new or edited entry. <c>At</c> defaults to now; <c>Data</c> is validated against the area.</summary>
/// <remarks><c>AiUsageId</c> is the capture this entry was saved from, if any (CaptureResult.CaptureId).</remarks>
public record EntryInput(string Area, Dictionary<string, JsonElement> Data, DateTimeOffset? At = null, string Source = "manual", string? Raw = null, Guid? AiUsageId = null);

public static class EntryEndpoints
{
    private static readonly string[] Sources = ["manual", "typed", "voice"];

    public static void MapEntryEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/entries").WithTags("Entries").RequireAuthorization();
        g.MapGet("/", List);
        g.MapGet("/latest", Latest);
        g.MapGet("/{id:guid}", Get);
        g.MapPost("/", Create);
        g.MapPut("/{id:guid}", Update);
        g.MapDelete("/{id:guid}", Delete);
    }

    /// <summary>Newest first. <c>area</c> narrows to one area; <c>limit</c> defaults to 50, at most 500.</summary>
    private static async Task<Ok<EntryDto[]>> List(HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct, string? area = null, int limit = 50)
    {
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<EntryRow>(
            $"select {Row.Columns} from entries where user_id = @user and (@area::text is null or area = @area) order by at desc limit @limit",
            new { user = http.User.UserId(), area, limit = Math.Clamp(limit, 1, 500) });
        return TypedResults.Ok(rows.Select(r => Row.ToDto(r, catalog)).ToArray());
    }

    /// <summary>The most recent entry in each area — what the Areas screen shows.</summary>
    private static async Task<Ok<EntryDto[]>> Latest(HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<EntryRow>(
            $"select distinct on (area) {Row.Columns} from entries where user_id = @user order by area, at desc",
            new { user = http.User.UserId() });
        return TypedResults.Ok(rows.Select(r => Row.ToDto(r, catalog)).ToArray());
    }

    private static async Task<Results<Ok<EntryDto>, NotFound>> Get(Guid id, HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<EntryRow>(
            $"select {Row.Columns} from entries where id = @id and user_id = @user", new { id, user = http.User.UserId() });
        return row is null ? TypedResults.NotFound() : TypedResults.Ok(Row.ToDto(row, catalog));
    }

    private static async Task<Results<Created<EntryDto>, ValidationProblem>> Create(EntryInput body, HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct)
    {
        var (data, problem) = Check(body, catalog);
        if (problem is not null) return problem;
        await using var conn = await db.OpenAsync(ct);
        var user = http.User.UserId();
        var atUtc = (body.At ?? DateTimeOffset.UtcNow).UtcDateTime;
        var (woke, wokeProblem) = await WokeAsync(conn, user, body.Area, data!, atUtc);
        if (wokeProblem is not null) return wokeProblem;
        var row = await conn.QuerySingleAsync<EntryRow>(
            $"""
            insert into entries (user_id, area, at, data, source, raw, ai_usage_id)
            values (@user, @area, @at, @data::jsonb, @source, @raw,
              (select id from ai_usage where id = @aiUsageId and user_id = @user))
            returning {Row.Columns}
            """,
            new
            {
                user, area = body.Area, at = atUtc,
                data = JsonSerializer.Serialize(data), source = body.Source, raw = body.Raw, aiUsageId = body.AiUsageId,
            });
        if (woke is { } w) await WakeTime.WriteToSleepAsync(conn, user, w.Zone, atUtc, w.Hhmm);
        return TypedResults.Created($"/entries/{row.Id}", Row.ToDto(row, catalog));
    }

    private static async Task<Results<Ok<EntryDto>, NotFound, ValidationProblem>> Update(Guid id, EntryInput body, HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct)
    {
        var (data, problem) = Check(body, catalog);
        if (problem is not null) return problem;
        await using var conn = await db.OpenAsync(ct);
        var user = http.User.UserId();
        var atUtc = body.At?.UtcDateTime
            ?? await conn.ExecuteScalarAsync<DateTime?>("select at from entries where id = @id and user_id = @user", new { id, user })
            ?? DateTime.UtcNow;
        var (woke, wokeProblem) = await WokeAsync(conn, user, body.Area, data!, atUtc);
        if (wokeProblem is not null) return wokeProblem;
        // The area and the original source stay what they were; an edit changes the reading and its time.
        var row = await conn.QuerySingleOrDefaultAsync<EntryRow>(
            $"""
            update entries set at = coalesce(@at, at), data = @data::jsonb, updated_at = now()
            where id = @id and user_id = @user and area = @area
            returning {Row.Columns}
            """,
            new { id, user, area = body.Area, at = body.At?.UtcDateTime, data = JsonSerializer.Serialize(data) });
        if (row is null) return TypedResults.NotFound();
        if (woke is { } w) await WakeTime.WriteToSleepAsync(conn, user, w.Zone, atUtc, w.Hhmm);
        return TypedResults.Ok(Row.ToDto(row, catalog));
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HttpContext http, Db db, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var n = await conn.ExecuteAsync("delete from entries where id = @id and user_id = @user", new { id, user = http.User.UserId() });
        return n == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    /// <summary>
    /// A blood pressure reading's "woke up" ("30 min ago", "8:30a"): stored as
    /// HH:mm, and handed back to be written to the sleep log once the reading
    /// is saved. Unreadable is a problem in words, not a silent drop.
    /// </summary>
    private static async Task<((string Zone, string Hhmm)? Woke, ValidationProblem? Problem)> WokeAsync(
        Npgsql.NpgsqlConnection conn, Guid user, string area, Dictionary<string, object?> data, DateTime atUtc)
    {
        if (area != "blood-pressure" || data.GetValueOrDefault(WakeTime.Field) is not string said || said.Trim().Length == 0) return (null, null);
        var clock = await Bo.Api.Schedules.ScheduleStore.ClockAsync(conn, user);
        if (WakeTime.Parse(said, clock.Local(atUtc)) is not { } hhmm)
            return (null, TypedResults.ValidationProblem(new Dictionary<string, string[]> { [WakeTime.Field] = ["Woke up: try a time like 8:30 or \"30 min ago\"."] }));
        data[WakeTime.Field] = hhmm;
        return ((clock.Zone.Id, hhmm), null);
    }

    private static (Dictionary<string, object?>? Data, ValidationProblem? Problem) Check(EntryInput body, AreaCatalog catalog)
    {
        var area = catalog.Find(body.Area);
        if (area is null || area.Kind != "log")
            return (null, TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["area"] = [$"No area \"{body.Area}\"."] }));
        if (!Sources.Contains(body.Source))
            return (null, TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["source"] = ["Source is manual, typed or voice."] }));
        var (data, problems) = catalog.Validate(area, AreaCatalog.FromJson(body.Data));
        return problems.Count > 0
            ? (null, TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["data"] = problems.ToArray() }))
            : (data, null);
    }

    private sealed class EntryRow
    {
        public Guid Id { get; set; }
        public string Area { get; set; } = "";
        public DateTime At { get; set; }
        public string Data { get; set; } = "{}";
        public string Source { get; set; } = "";
        public string? Raw { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    private static class Row
    {
        public const string Columns = "id, area, at, data::text as data, source, raw, created_at";

        public static EntryDto ToDto(EntryRow r, AreaCatalog catalog)
        {
            var data = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(r.Data) ?? [];
            var area = catalog.Find(r.Area);
            // An entry whose area was removed from the folder still reads; it just has no template.
            var summary = area is null ? r.Area : AreaCatalog.Summarize(area, data.ToDictionary(kv => kv.Key, kv => (object?)kv.Value));
            return new EntryDto(r.Id, r.Area, r.At, data, summary, r.Source, r.Raw, r.CreatedAt);
        }
    }
}
