using Bo.Api.Areas;
using Bo.Api.Auth;
using Bo.Api.Data;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;
using Npgsql;

namespace Bo.Api.Endpoints;

public record VocabularyItem(Guid Id, string Term, string[] Heard, DateTime CreatedAt);

/// <param name="Term">The word as it should be written, e.g. "tirzepatide".</param>
/// <param name="Heard">Known mishearings, e.g. "teresa appetite". Optional.</param>
public record VocabularyInput(string Term, string[]? Heard = null);

/// <summary>
/// The words Bo listens for. Each person has their own list, edited on the
/// phone; areas/_vocabulary.json seeds it the first time it's read. The app
/// hands the terms to the speech recognizer as expected words.
/// </summary>
public static class VocabularyEndpoints
{
    private const int MaxTerms = 100; // Apple's guidance for contextual strings
    private const int MaxLength = 60;
    private const int MaxHeard = 10;
    private const string Columns = "id, term, heard, created_at as createdat";

    // Dapper can't hand a text[] to a positional record's constructor, so rows
    // land in a settable class and are copied out.
    private sealed class Row
    {
        public Guid Id { get; set; }
        public string Term { get; set; } = "";
        public string[] Heard { get; set; } = [];
        public DateTime CreatedAt { get; set; }
        public VocabularyItem ToItem() => new(Id, Term, Heard, CreatedAt);
    }

    public static void MapVocabularyEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/vocabulary").WithTags("Vocabulary").RequireAuthorization();
        g.MapGet("/", List);
        g.MapPost("/", Create);
        g.MapPut("/{id:guid}", Update);
        g.MapDelete("/{id:guid}", Delete);
    }

    private static async Task<Ok<VocabularyItem[]>> List(HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct)
    {
        var user = http.User.UserId();
        await using var conn = await db.OpenAsync(ct);
        await SeedOnce(conn, user, catalog, ct);
        var rows = await conn.QueryAsync<Row>(
            $"select {Columns} from vocabulary_terms where user_id = @user order by lower(term)", new { user });
        return TypedResults.Ok(rows.Select(r => r.ToItem()).ToArray());
    }

    /// <summary>Copy the starter list in, once per person, so later deletes stick.</summary>
    private static async Task SeedOnce(NpgsqlConnection conn, Guid user, AreaCatalog catalog, CancellationToken ct)
    {
        await using var tx = await conn.BeginTransactionAsync(ct);
        var claimed = await conn.ExecuteAsync(
            "update users set vocabulary_seeded = true where id = @user and not vocabulary_seeded", new { user }, tx);
        if (claimed == 1)
        {
            foreach (var t in catalog.Vocabulary)
                await conn.ExecuteAsync(
                    """
                    insert into vocabulary_terms (user_id, term, heard) values (@user, @term, @heard)
                    on conflict (user_id, lower(term)) do nothing
                    """,
                    new { user, term = t.Term, heard = t.Heard }, tx);
        }
        await tx.CommitAsync(ct);
    }

    private static async Task<Results<Created<VocabularyItem>, ValidationProblem>> Create(VocabularyInput body, HttpContext http, Db db, AreaCatalog catalog, CancellationToken ct)
    {
        if (Clean(body) is not { } clean) return Invalid("term", "Type a word.");
        var (term, heard) = clean;
        var user = http.User.UserId();
        await using var conn = await db.OpenAsync(ct);
        await SeedOnce(conn, user, catalog, ct); // so a first add doesn't later get the starters dumped beside it unseen
        if (await conn.ExecuteScalarAsync<int>("select count(*) from vocabulary_terms where user_id = @user", new { user }) >= MaxTerms)
            return Invalid("term", $"The list holds up to {MaxTerms} words. Remove one first.");
        try
        {
            var row = await conn.QuerySingleAsync<Row>(
                $"insert into vocabulary_terms (user_id, term, heard) values (@user, @term, @heard) returning {Columns}",
                new { user, term, heard });
            return TypedResults.Created($"/vocabulary/{row.Id}", row.ToItem());
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Invalid("term", $"\"{term}\" is already on the list.");
        }
    }

    private static async Task<Results<Ok<VocabularyItem>, NotFound, ValidationProblem>> Update(Guid id, VocabularyInput body, HttpContext http, Db db, CancellationToken ct)
    {
        if (Clean(body) is not { } clean) return Invalid("term", "Type a word.");
        var (term, heard) = clean;
        await using var conn = await db.OpenAsync(ct);
        try
        {
            var row = await conn.QuerySingleOrDefaultAsync<Row>(
                $"""
                update vocabulary_terms set term = @term, heard = @heard, updated_at = now()
                where id = @id and user_id = @user returning {Columns}
                """,
                new { id, user = http.User.UserId(), term, heard });
            return row is null ? TypedResults.NotFound() : TypedResults.Ok(row.ToItem());
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Invalid("term", $"\"{term}\" is already on the list.");
        }
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HttpContext http, Db db, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var n = await conn.ExecuteAsync("delete from vocabulary_terms where id = @id and user_id = @user", new { id, user = http.User.UserId() });
        return n == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    /// <summary>Trim and bound the input; null when there's no word.</summary>
    private static (string Term, string[] Heard)? Clean(VocabularyInput body)
    {
        var term = body.Term?.Trim() ?? "";
        if (term.Length == 0) return null;
        if (term.Length > MaxLength) term = term[..MaxLength];
        var heard = (body.Heard ?? [])
            .Select(h => h.Trim().ToLowerInvariant())
            .Where(h => h.Length > 0 && !h.Equals(term, StringComparison.OrdinalIgnoreCase))
            .Select(h => h.Length > MaxLength ? h[..MaxLength] : h)
            .Distinct()
            .Take(MaxHeard)
            .ToArray();
        return (term, heard);
    }

    private static ValidationProblem Invalid(string field, string message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
