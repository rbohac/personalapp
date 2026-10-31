using Bo.Api.Auth;
using Bo.Api.Data;
using Dapper;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;

namespace Bo.Api.Endpoints;

public record GoogleSignInRequest(string IdToken);
public record UserDto(Guid Id, string Email, string? Name);
public record SessionDto(string Token, DateTime ExpiresAt, UserDto User);

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/auth/google", SignInWithGoogle).WithTags("Auth").AllowAnonymous();
        app.MapGet("/me", Me).WithTags("Auth").RequireAuthorization();
    }

    /// <summary>
    /// Exchange a Google ID token (from native Google Sign-In on the phone)
    /// for a Bo access token. Google proves who you are; the allowlist decides
    /// whether that person may use Bo.
    /// </summary>
    private static async Task<Results<Ok<SessionDto>, UnauthorizedHttpResult, ForbidHttpResult, ProblemHttpResult>> SignInWithGoogle(
        GoogleSignInRequest body, IOptions<AuthOptions> options, TokenService tokens, Db db, ILoggerFactory logs, CancellationToken ct)
    {
        var o = options.Value;
        var log = logs.CreateLogger("Auth");
        if (o.GoogleClientIds.Length == 0)
            return TypedResults.Problem("Google sign-in is not configured (Auth__GoogleClientIds__0).", statusCode: 503);

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(body.IdToken,
                new GoogleJsonWebSignature.ValidationSettings { Audience = o.GoogleClientIds });
        }
        catch (InvalidJwtException e)
        {
            log.LogWarning("Refused a Google token: {Reason}", e.Message);
            return TypedResults.Unauthorized();
        }

        var email = payload.Email?.Trim().ToLowerInvariant();
        if (email is null || !payload.EmailVerified || !o.AllowedEmails.Any(a => a.Equals(email, StringComparison.OrdinalIgnoreCase)))
        {
            // The address is logged so a refusal is diagnosable from `fly logs`.
            log.LogWarning("Refused sign-in for {Email}: not on the allowlist or not verified.", email);
            return TypedResults.Forbid();
        }

        await using var conn = await db.OpenAsync(ct);
        var user = await conn.QuerySingleAsync<UserDto>(
            """
            insert into users (email, name) values (@email, @name)
            on conflict (email) do update set name = coalesce(excluded.name, users.name), last_seen_at = now()
            returning id, email, name
            """,
            new { email, name = payload.Name });

        var (token, expiresAt) = tokens.Issue(user.Id, user.Email);
        return TypedResults.Ok(new SessionDto(token, expiresAt, user));
    }

    private static async Task<Results<Ok<UserDto>, UnauthorizedHttpResult>> Me(HttpContext http, Db db, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var user = await conn.QuerySingleOrDefaultAsync<UserDto>(
            "select id, email, name from users where id = @id", new { id = http.User.UserId() });
        // A token for a user who no longer exists is as good as no token.
        return user is null ? TypedResults.Unauthorized() : TypedResults.Ok(user);
    }
}
