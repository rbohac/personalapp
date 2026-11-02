using Bo.Api.Auth;
using Bo.Api.Data;
using Bo.Api.Schedules;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Bo.Api.Endpoints;

public record RegisterDeviceRequest(string InstallationId, string ExpoToken, string Platform);

/// <summary>One registered phone. <c>Token</c> is the end of the Expo token, enough to tell two apart.</summary>
public record PushDevice(string Platform, string Token, DateTime LastSeenAt, bool ThisPhone);

/// <summary>One push the server sent (or tried to). Outcome: sent, delivered, failed, no-devices, disabled.</summary>
public record PushLogEntry(DateTime At, string Title, int Devices, string Outcome, string? Detail);

/// <summary>Everything about server push for the signed-in person, for "why didn't I get a reminder?".</summary>
public record PushStatus(string? TimeZone, string QuietHours, PushDevice[] Devices, PushLogEntry[] Recent);

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
        g.MapGet("/status", Status);
        g.MapPost("/test", Test);
    }

    /// <summary>The zone the nudges run on, the phones registered, and the last 15 pushes with what Expo and Apple said.</summary>
    private static async Task<Ok<PushStatus>> Status(HttpContext http, Db db, ExpoPush push, CancellationToken ct, string? installationId = null)
    {
        var user = http.User.UserId();
        await push.CheckReceiptsAsync(ct);
        await using var conn = await db.OpenAsync(ct);
        var u = await conn.QuerySingleAsync<(string? Zone, int Start, int End)>(
            "select time_zone, quiet_start_minute, quiet_end_minute from users where id = @user", new { user });
        var devices = (await conn.QueryAsync<(string InstallationId, string Platform, string Token, DateTime LastSeen)>(
            "select installation_id, platform, expo_token, last_seen_at from push_devices where user_id = @user order by last_seen_at desc", new { user }))
            .Select(d => new PushDevice(d.Platform, d.Token.Length > 8 ? "…" + d.Token[^8..] : d.Token, d.LastSeen, d.InstallationId == installationId))
            .ToArray();
        var recent = (await conn.QueryAsync<(DateTime At, string Title, int Devices, string Outcome, string? Detail)>(
            "select at, title, devices, outcome, detail from push_log where user_id = @user order by at desc limit 15", new { user }))
            .Select(r => new PushLogEntry(r.At, r.Title, r.Devices, r.Outcome, r.Detail)).ToArray();
        return TypedResults.Ok(new PushStatus(u.Zone, $"{ScheduleLogic.Hhmm(u.Start)}–{ScheduleLogic.Hhmm(u.End)}", devices, recent));
    }

    /// <summary>
    /// Send a test push from the server to every registered phone, then wait
    /// a few seconds for Expo's receipt so the answer says whether Apple took it.
    /// </summary>
    private static async Task<Ok<PushLogEntry>> Test(HttpContext http, ExpoPush push, Db db, CancellationToken ct)
    {
        var user = http.User.UserId();
        var r = await push.SendAsync(user, new PushMessage("Bo server test", "Server pushes reach this phone.", new { kind = "test" }), ct);
        for (var i = 0; i < 6 && r.Outcome == "sent"; i++)
        {
            await Task.Delay(TimeSpan.FromSeconds(2), ct);
            await push.CheckReceiptsAsync(ct, r.LogId);
            await using var conn = await db.OpenAsync(ct);
            var now = await conn.QuerySingleAsync<(string Outcome, string? Detail)>("select outcome, detail from push_log where id = @id", new { id = r.LogId });
            r = r with { Outcome = now.Outcome, Detail = now.Detail };
        }
        return TypedResults.Ok(new PushLogEntry(DateTime.UtcNow, "Bo server test", r.Devices, r.Outcome, r.Detail));
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
