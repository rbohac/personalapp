using System.Text.Json;
using Bo.Api.Auth;
using Bo.Api.Data;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;
using Npgsql;

namespace Bo.Api.Endpoints;

public record ChecklistItem(Guid Id, string Text, bool Done);

/// <param name="DoneCount">How many are ticked.</param>
public record ChecklistDto(Guid Id, string Title, ChecklistItem[] Items, int DoneCount, DateTime UpdatedAt);

/// <summary>A new or edited list: its title and items in order, one line each. A line kept from before keeps its tick.</summary>
public record ChecklistInput(string Title, string[] Items);

/// <summary>Tick (or untick) one item.</summary>
public record ChecklistTick(bool Done);

/// <summary>
/// Reusable checklists — the travel packing list first. Tick items off while
/// packing; Start over unticks everything for the next trip. One person
/// edits a list, so a list is one row with its items as JSON.
/// </summary>
public static class ChecklistEndpoints
{
    private const int MaxItems = 100;
    private const int MaxText = 100;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed class Row
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = "";
        public string Items { get; set; } = "[]";
        public DateTime UpdatedAt { get; set; }
        public ChecklistItem[] Parsed => JsonSerializer.Deserialize<ChecklistItem[]>(Items, Json) ?? [];
        public ChecklistDto ToDto()
        {
            var items = Parsed;
            return new ChecklistDto(Id, Title, items, items.Count(i => i.Done), UpdatedAt);
        }
    }

    private const string Columns = "id, title, items::text as items, updated_at as updatedat";

    public static void MapChecklistEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/checklists").WithTags("Checklists").RequireAuthorization();
        g.MapGet("/", List);
        g.MapPost("/", Create);
        g.MapPut("/{id:guid}", Update);
        g.MapDelete("/{id:guid}", Delete);
        g.MapPost("/{id:guid}/items/{itemId:guid}", Tick);
        g.MapPost("/{id:guid}/reset", Reset);
    }

    private static async Task<Ok<ChecklistDto[]>> List(HttpContext http, Db db)
    {
        await using var conn = await db.OpenAsync();
        var rows = await conn.QueryAsync<Row>($"select {Columns} from checklists where user_id = @user order by sort, created_at", new { user = http.User.UserId() });
        return TypedResults.Ok(rows.Select(r => r.ToDto()).ToArray());
    }

    private static async Task<Results<Created<ChecklistDto>, ValidationProblem>> Create(ChecklistInput body, HttpContext http, Db db)
    {
        if (Problem(body) is { } p) return Invalid(p);
        await using var conn = await db.OpenAsync();
        var items = Clean(body.Items, []);
        var row = await conn.QuerySingleAsync<Row>(
            $"""
            insert into checklists (user_id, title, items, sort)
            values (@user, @title, @items::jsonb, coalesce((select max(sort) + 1 from checklists where user_id = @user), 0))
            returning {Columns}
            """,
            new { user = http.User.UserId(), title = body.Title.Trim(), items = JsonSerializer.Serialize(items, Json) });
        return TypedResults.Created($"/checklists/{row.Id}", row.ToDto());
    }

    private static async Task<Results<Ok<ChecklistDto>, NotFound, ValidationProblem>> Update(Guid id, ChecklistInput body, HttpContext http, Db db)
    {
        if (Problem(body) is { } p) return Invalid(p);
        await using var conn = await db.OpenAsync();
        var user = http.User.UserId();
        if (await Get(conn, user, id) is not { } row) return TypedResults.NotFound();
        var items = Clean(body.Items, row.Parsed);
        return TypedResults.Ok(await Save(conn, user, id, items, body.Title.Trim()));
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HttpContext http, Db db)
    {
        await using var conn = await db.OpenAsync();
        var n = await conn.ExecuteAsync("delete from checklists where id = @id and user_id = @user", new { id, user = http.User.UserId() });
        return n == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    private static async Task<Results<Ok<ChecklistDto>, NotFound>> Tick(Guid id, Guid itemId, ChecklistTick body, HttpContext http, Db db)
    {
        await using var conn = await db.OpenAsync();
        var user = http.User.UserId();
        if (await Get(conn, user, id) is not { } row) return TypedResults.NotFound();
        var items = row.Parsed;
        if (!items.Any(i => i.Id == itemId)) return TypedResults.NotFound();
        return TypedResults.Ok(await Save(conn, user, id, items.Select(i => i.Id == itemId ? i with { Done = body.Done } : i).ToArray()));
    }

    /// <summary>Untick everything, for the next trip.</summary>
    private static async Task<Results<Ok<ChecklistDto>, NotFound>> Reset(Guid id, HttpContext http, Db db)
    {
        await using var conn = await db.OpenAsync();
        var user = http.User.UserId();
        if (await Get(conn, user, id) is not { } row) return TypedResults.NotFound();
        return TypedResults.Ok(await Save(conn, user, id, row.Parsed.Select(i => i with { Done = false }).ToArray()));
    }

    private static Task<Row?> Get(NpgsqlConnection conn, Guid user, Guid id) =>
        conn.QuerySingleOrDefaultAsync<Row>($"select {Columns} from checklists where id = @id and user_id = @user", new { id, user });

    private static async Task<ChecklistDto> Save(NpgsqlConnection conn, Guid user, Guid id, ChecklistItem[] items, string? title = null) =>
        (await conn.QuerySingleAsync<Row>(
            $"""
            update checklists set items = @items::jsonb, title = coalesce(@title, title), updated_at = now()
            where id = @id and user_id = @user returning {Columns}
            """,
            new { id, user, title, items = JsonSerializer.Serialize(items, Json) })).ToDto();

    /// <summary>Lines in order, trimmed, blanks and repeats dropped. A line that was already there keeps its id and tick.</summary>
    private static ChecklistItem[] Clean(string[] lines, ChecklistItem[] before)
    {
        var old = before.GroupBy(i => i.Text.ToLowerInvariant()).ToDictionary(g => g.Key, g => g.First());
        return lines.Select(l => l.Trim()).Where(l => l.Length > 0).Select(l => l.Length > MaxText ? l[..MaxText] : l)
            .DistinctBy(l => l.ToLowerInvariant()).Take(MaxItems)
            .Select(l => old.TryGetValue(l.ToLowerInvariant(), out var o) ? o with { Text = l } : new ChecklistItem(Guid.NewGuid(), l, false))
            .ToArray();
    }

    private static string? Problem(ChecklistInput b) =>
        string.IsNullOrWhiteSpace(b.Title) ? "Give it a name." : b.Title.Trim().Length > 60 ? "Keep the name under 60 characters." : null;

    private static ValidationProblem Invalid(string message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["checklist"] = [message] });
}
