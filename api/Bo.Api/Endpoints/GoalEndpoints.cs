using Bo.Api.Areas;
using Bo.Api.Auth;
using Bo.Api.Goals;
using Bo.Api.Schedules;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

/// <summary>Weekly goals: how many days, or how much, each week. Progress is worked out from entries.</summary>
public static class GoalEndpoints
{
    public static void MapGoalEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/goals").WithTags("Goals").RequireAuthorization();
        g.MapGet("/", List);
        g.MapPost("/", Create);
        g.MapPut("/{id:guid}", Update);
        g.MapDelete("/{id:guid}", Delete);
    }

    /// <summary>Every goal with this week's progress. <c>tz</c> is the phone's zone.</summary>
    private static async Task<Ok<GoalDto[]>> List(HttpContext http, GoalStore store, TimeProvider time, string? tz = null)
    {
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        await ScheduleStore.SetZoneAsync(conn, user, tz);
        await store.SeedOnceAsync(conn, user);
        var clock = await ScheduleStore.ClockAsync(conn, user);
        var now = time.GetUtcNow().UtcDateTime;
        var list = new List<GoalDto>();
        foreach (var goal in await GoalStore.ListAsync(conn, user)) list.Add(await store.DtoAsync(conn, goal, clock, now));
        return TypedResults.Ok(list.ToArray());
    }

    private static async Task<Results<Created<GoalDto>, ValidationProblem>> Create(GoalInput body, HttpContext http, GoalStore store, TimeProvider time)
    {
        if (Problem(body, store.Catalog) is { } p) return Invalid(p);
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        await store.SeedOnceAsync(conn, user);
        var c = Clean(body);
        var id = await conn.ExecuteScalarAsync<Guid>(
            """
            insert into goals (user_id, title, area, measure, field, target, exclude_field, exclude_values, paused, sort)
            values (@user, @Title, @Area, @Measure, @Field, @Target, @ExcludeField, @ExcludeValues, @Paused,
              coalesce((select max(sort) + 1 from goals where user_id = @user), 0))
            returning id
            """,
            new { user, c.Title, c.Area, c.Measure, c.Field, c.Target, c.ExcludeField, c.ExcludeValues, c.Paused });
        return TypedResults.Created($"/goals/{id}", await Fresh(conn, store, user, id, time));
    }

    private static async Task<Results<Ok<GoalDto>, NotFound, ValidationProblem>> Update(Guid id, GoalInput body, HttpContext http, GoalStore store, TimeProvider time)
    {
        if (Problem(body, store.Catalog) is { } p) return Invalid(p);
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        var c = Clean(body);
        var n = await conn.ExecuteAsync(
            """
            update goals set title = @Title, area = @Area, measure = @Measure, field = @Field, target = @Target,
              exclude_field = @ExcludeField, exclude_values = @ExcludeValues, paused = @Paused, updated_at = now()
            where id = @id and user_id = @user
            """,
            new { id, user, c.Title, c.Area, c.Measure, c.Field, c.Target, c.ExcludeField, c.ExcludeValues, c.Paused });
        return n == 0 ? TypedResults.NotFound() : TypedResults.Ok(await Fresh(conn, store, user, id, time));
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HttpContext http, GoalStore store)
    {
        await using var conn = await store.Db.OpenAsync();
        var n = await conn.ExecuteAsync("delete from goals where id = @id and user_id = @user", new { id, user = http.User.UserId() });
        return n == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    private static async Task<GoalDto> Fresh(Npgsql.NpgsqlConnection conn, GoalStore store, Guid user, Guid id, TimeProvider time)
    {
        var g = await conn.QuerySingleAsync<GoalRow>($"select {GoalRow.Columns} from goals where id = @id and user_id = @user", new { id, user });
        return await store.DtoAsync(conn, g, await ScheduleStore.ClockAsync(conn, user), time.GetUtcNow().UtcDateTime);
    }

    private static GoalInput Clean(GoalInput b) => b with
    {
        Title = b.Title.Trim(),
        Field = b.Measure == "total" ? b.Field : null,
        ExcludeField = b.ExcludeField is { Length: > 0 } ef ? ef : null,
        ExcludeValues = (b.ExcludeValues ?? []).Select(v => v.Trim()).Where(v => v.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Take(20).ToArray(),
    };

    private static string? Problem(GoalInput b, AreaCatalog catalog) =>
        string.IsNullOrWhiteSpace(b.Title) ? "Give it a name."
        : AreaCatalog.GoalProblem(catalog.Find(b.Area), b.Measure, b.Field, b.Target, b.ExcludeField);

    private static ValidationProblem Invalid(string message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["goal"] = [message] });
}
