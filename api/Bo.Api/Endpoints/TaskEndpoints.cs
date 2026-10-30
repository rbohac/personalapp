using Bo.Api.Areas;
using Bo.Api.Auth;
using Bo.Api.Data;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

public record TaskDto(
    Guid Id, string Title, string? Notes, string List, DateTime? DueAt, DateTime? RemindAt,
    DateTime? DoneAt, DateTime CreatedAt, DateTime UpdatedAt);

/// <summary>
/// The whole editable task. Used for both create and update: the phone always
/// sends the form as it stands, so "clear the reminder" is just remindAt: null
/// and there is no partial-update ambiguity to get wrong.
/// </summary>
/// <remarks><c>List</c> is one of the lists in areas/tasks/area.json.</remarks>
public record TaskInput(string Title, string? Notes = null, DateTimeOffset? DueAt = null, DateTimeOffset? RemindAt = null, string List = "personal");

public static class TaskEndpoints
{
    // Aliased to the record's names, in the record's order: Dapper builds a
    // positional record through its constructor.
    private const string Columns =
        "id, title, notes, list, due_at as dueat, remind_at as remindat, done_at as doneat, created_at as createdat, updated_at as updatedat";

    public static void MapTaskEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/tasks").WithTags("Tasks").RequireAuthorization();
        g.MapGet("/", List);
        g.MapPost("/", Create);
        g.MapGet("/{id:guid}", Get);
        g.MapPut("/{id:guid}", Update);
        g.MapPost("/{id:guid}/complete", (Guid id, HttpContext http, Db db, CancellationToken ct) => SetDone(id, true, http, db, ct));
        g.MapPost("/{id:guid}/reopen", (Guid id, HttpContext http, Db db, CancellationToken ct) => SetDone(id, false, http, db, ct));
        g.MapDelete("/{id:guid}", Delete);
    }

    /// <summary>
    /// Open tasks come back with the ones that have a date first (soonest
    /// first), then undated ones newest first. Done tasks newest-finished first.
    /// <c>filter</c> is open (default), done or all; <c>list</c> narrows to one list.
    /// </summary>
    private static async Task<Ok<TaskDto[]>> List(HttpContext http, Db db, CancellationToken ct, string filter = "open", string? list = null)
    {
        var where = filter switch
        {
            "done" => "and done_at is not null",
            "all" => "",
            _ => "and done_at is null",
        };
        var order = filter == "done"
            ? "done_at desc"
            : "done_at is not null, coalesce(due_at, remind_at) asc nulls last, created_at desc";

        await using var conn = await db.OpenAsync(ct);
        var rows = await conn.QueryAsync<TaskDto>(
            $"select {Columns} from tasks where user_id = @user and (@list::text is null or list = @list) {where} order by {order} limit 500",
            new { user = http.User.UserId(), list });
        return TypedResults.Ok(rows.ToArray());
    }

    private static async Task<Results<Ok<TaskDto>, NotFound>> Get(Guid id, HttpContext http, Db db, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<TaskDto>(
            $"select {Columns} from tasks where id = @id and user_id = @user",
            new { id, user = http.User.UserId() });
        return row is null ? TypedResults.NotFound() : TypedResults.Ok(row);
    }

    private static async Task<Results<Created<TaskDto>, ValidationProblem>> Create(TaskInput body, HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct)
    {
        if (Invalid(body, catalog) is { } problem) return problem;
        await using var conn = await db.OpenAsync(ct);
        var row = await conn.QuerySingleAsync<TaskDto>(
            $"""
            insert into tasks (user_id, title, notes, list, due_at, remind_at)
            values (@user, @title, @notes, @list, @dueAt, @remindAt)
            returning {Columns}
            """,
            Params(body, http, null));
        return TypedResults.Created($"/tasks/{row.Id}", row);
    }

    private static async Task<Results<Ok<TaskDto>, NotFound, ValidationProblem>> Update(Guid id, TaskInput body, HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct)
    {
        if (Invalid(body, catalog) is { } problem) return problem;
        await using var conn = await db.OpenAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<TaskDto>(
            $"""
            update tasks set title = @title, notes = @notes, list = @list, due_at = @dueAt, remind_at = @remindAt, updated_at = now()
            where id = @id and user_id = @user
            returning {Columns}
            """,
            Params(body, http, id));
        return row is null ? TypedResults.NotFound() : TypedResults.Ok(row);
    }

    private static async Task<Results<Ok<TaskDto>, NotFound>> SetDone(Guid id, bool done, HttpContext http, Db db, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        // Completing an already-done task keeps its original finish time.
        var row = await conn.QuerySingleOrDefaultAsync<TaskDto>(
            $"""
            update tasks set done_at = case when @done then coalesce(done_at, now()) else null end, updated_at = now()
            where id = @id and user_id = @user
            returning {Columns}
            """,
            new { id, done, user = http.User.UserId() });
        return row is null ? TypedResults.NotFound() : TypedResults.Ok(row);
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HttpContext http, Db db, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var n = await conn.ExecuteAsync("delete from tasks where id = @id and user_id = @user", new { id, user = http.User.UserId() });
        return n == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    private static ValidationProblem? Invalid(TaskInput body, AreaCatalog catalog)
    {
        string? title = string.IsNullOrWhiteSpace(body.Title) ? "A task needs a title."
            : body.Title.Length > 500 ? "Keep the title under 500 characters." : null;
        if (title is not null) return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["title"] = [title] });
        var lists = catalog.Tasks.Lists;
        return lists.Any(l => l.Id == body.List) ? null
            : TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["list"] = [$"Lists are {string.Join(", ", lists.Select(l => l.Id))}."] });
    }

    // Npgsql only writes UTC DateTimes to timestamptz, so offsets are
    // converted here rather than at every call site.
    private static object Params(TaskInput b, HttpContext http, Guid? id) => new
    {
        id,
        user = http.User.UserId(),
        title = b.Title.Trim(),
        notes = string.IsNullOrWhiteSpace(b.Notes) ? null : b.Notes,
        list = b.List,
        dueAt = b.DueAt?.UtcDateTime,
        remindAt = b.RemindAt?.UtcDateTime,
    };

}
