using Bo.Api.Areas;
using Bo.Api.Auth;
using Bo.Api.Capture;
using Bo.Api.Data;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

public static class CaptureEndpoints
{
    public static void MapCaptureEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/capture", Capture).WithTags("Capture").RequireAuthorization();
    }

    /// <summary>Read a typed or spoken capture into proposals. Saves nothing.</summary>
    private static async Task<Results<Ok<CaptureResult>, ValidationProblem>> Capture(
        CaptureRequest body, HttpContext http, Db db, AreaCatalog catalog, CaptureParser parser, CancellationToken ct)
    {
        var text = body.Text?.Trim() ?? "";
        if (text.Length is 0 or > 1000)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["text"] = ["Say or type something under 1,000 characters."] });

        // The newest entry per area lets "took my shot" reuse the medication last recorded.
        await using var conn = await db.OpenAsync(ct);
        var latest = await conn.QueryAsync<(string Area, string Data, DateTime At)>(
            "select distinct on (area) area, data::text, at from entries where user_id = @user order by area, at desc",
            new { user = http.User.UserId() });
        var recent = latest
            .Select(r => (r.Area, Summary: catalog.Find(r.Area) is { } a
                ? AreaCatalog.Summarize(a, System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, System.Text.Json.JsonElement>>(r.Data)!
                    .ToDictionary(kv => kv.Key, kv => (object?)kv.Value))
                : r.Area, r.At))
            .ToList();

        return TypedResults.Ok(await parser.ParseAsync(body with { Text = text }, recent, ct));
    }
}
