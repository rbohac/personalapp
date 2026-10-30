using Bo.Api.Auth;
using Bo.Api.Data;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

public record RegisterDeviceRequest(string InstallationId, string ExpoToken, string Platform);

/// <summary>
/// The phones Bo can ring with a server push. Keyed by an id the app mints
/// once per install, so a rotated Expo token updates the row instead of
/// adding a second one. Sending pushes arrives in a later phase; local
/// reminders need none of this.
/// </summary>
public static class DeviceEndpoints
{
    public static void MapDeviceEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/devices").WithTags("Devices").RequireAuthorization();
        g.MapPost("/", Register);
        g.MapDelete("/{installationId}", Remove);
    }

    private static async Task<Results<NoContent, ValidationProblem>> Register(RegisterDeviceRequest body, HttpContext http, Db db, CancellationToken ct)
    {
        if (!body.ExpoToken.StartsWith("ExponentPushToken[") || string.IsNullOrWhiteSpace(body.InstallationId))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["expoToken"] = ["Not an Expo push token."] });

        await using var conn = await db.OpenAsync(ct);
        await conn.ExecuteAsync(
            """
            insert into push_devices (installation_id, user_id, expo_token, platform)
            values (@InstallationId, @user, @ExpoToken, @Platform)
            on conflict (installation_id) do update
              set user_id = excluded.user_id, expo_token = excluded.expo_token,
                  platform = excluded.platform, last_seen_at = now()
            """,
            new { body.InstallationId, body.ExpoToken, body.Platform, user = http.User.UserId() });
        return TypedResults.NoContent();
    }

    private static async Task<NoContent> Remove(string installationId, HttpContext http, Db db, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await conn.ExecuteAsync("delete from push_devices where installation_id = @installationId and user_id = @user",
            new { installationId, user = http.User.UserId() });
        return TypedResults.NoContent();
    }
}
