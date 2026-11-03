using System.Text;
using Bo.Api.Auth;
using Bo.Api.Data;
using Dapper;

namespace Bo.Api.Sync;

/// <summary>
/// A change sent with an <c>Idempotency-Key</c> header happens once: the
/// first answer is stored, and the same key sent again (the phone retrying
/// after an answer it never got) gets that answer back without the change
/// being made a second time. Only signed-in POST, PUT and DELETE; answers
/// with a 5xx aren't stored, so those are retried for real.
/// </summary>
public sealed class Idempotency(RequestDelegate next, ILogger<Idempotency> log)
{
    public async Task InvokeAsync(HttpContext http, Db db)
    {
        var key = http.Request.Headers["Idempotency-Key"].ToString();
        if (key.Length is 0 or > 100 || HttpMethods.IsGet(http.Request.Method) || http.User.Identity?.IsAuthenticated != true)
        {
            await next(http);
            return;
        }
        var user = http.User.UserId();
        await using (var conn = await db.OpenAsync(http.RequestAborted))
        {
            var seen = await conn.QuerySingleOrDefaultAsync<(int Status, string? ContentType, string? Body)?>(
                "select status, content_type, body from idempotency_keys where user_id = @user and key = @key", new { user, key });
            if (seen is { } s)
            {
                http.Response.StatusCode = s.Status;
                if (s.ContentType is not null) http.Response.ContentType = s.ContentType;
                http.Response.Headers["Idempotent-Replay"] = "true";
                if (s.Body is not null) await http.Response.WriteAsync(s.Body);
                return;
            }
        }

        var original = http.Response.Body;
        using var buffer = new MemoryStream();
        http.Response.Body = buffer;
        try
        {
            await next(http);
        }
        finally
        {
            http.Response.Body = original;
        }
        buffer.Position = 0;
        var body = Encoding.UTF8.GetString(buffer.ToArray());
        if (http.Response.StatusCode < 500)
        {
            try
            {
                await using var conn = await db.OpenAsync(CancellationToken.None);
                await conn.ExecuteAsync(
                    """
                    insert into idempotency_keys (user_id, key, status, content_type, body) values (@user, @key, @status, @type, @body)
                    on conflict do nothing
                    """,
                    new { user, key, status = http.Response.StatusCode, type = http.Response.ContentType, body = body.Length > 0 ? body : null });
            }
            catch (Exception e)
            {
                log.LogWarning(e, "Couldn't store an idempotency key; a retry would repeat the change.");
            }
        }
        buffer.Position = 0;
        await buffer.CopyToAsync(original);
    }
}
