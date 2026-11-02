using Bo.Api.Areas;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

public static class AreaEndpoints
{
    public static void MapAreaEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/areas", (AreaCatalog catalog) => TypedResults.Ok(catalog.Areas.ToArray()))
            .WithTags("Areas").RequireAuthorization();
    }
}
