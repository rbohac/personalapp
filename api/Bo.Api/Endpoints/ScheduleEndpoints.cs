using Bo.Api.Auth;
using Bo.Api.Schedules;
using Dapper;
using Microsoft.AspNetCore.Http.HttpResults;
using Npgsql;

namespace Bo.Api.Endpoints;

/// <summary>
/// Schedules: what to take and when. A schedule is done when a matching entry
/// is logged — by voice, typed, or the Done button here, which logs one.
/// Every read brings every-N-days schedules up to date with doses logged
/// since, so a late dose moves the cadence the moment it's logged.
/// </summary>
public static class ScheduleEndpoints
{
    public static void MapScheduleEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/schedules").WithTags("Schedules").RequireAuthorization();
        g.MapGet("/", List);
        g.MapPost("/", Create);
        g.MapPut("/{id:guid}", Update);
        g.MapDelete("/{id:guid}", Delete);
        g.MapPost("/{id:guid}/done", Done);
        g.MapPost("/{id:guid}/snooze", Snooze);
        g.MapPost("/{id:guid}/items", SetItem);
        g.MapGet("/{id:guid}/history", History);
        g.MapPost("/{id:guid}/keep-day", KeepDay);
        g.MapPost("/{id:guid}/accept-day", AcceptDay);

        app.MapPut("/me/time-zone", async (TimeZoneInput body, HttpContext http, ScheduleStore store) =>
        {
            await using var conn = await store.Db.OpenAsync();
            await ScheduleStore.SetZoneAsync(conn, http.User.UserId(), body.TimeZone);
            return TypedResults.NoContent();
        }).WithTags("Schedules").RequireAuthorization();
    }

    /// <summary>Every schedule with where it stands now. <c>tz</c> is the phone's zone (also saved for nudges).</summary>
    private static async Task<Ok<ScheduleDto[]>> List(HttpContext http, ScheduleStore store, TimeProvider time, string? tz = null)
    {
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        await ScheduleStore.SetZoneAsync(conn, user, tz);
        var clock = await ScheduleStore.ClockAsync(conn, user);
        var now = time.GetUtcNow().UtcDateTime;
        await store.SeedOnceAsync(conn, user, clock, now);
        var list = new List<ScheduleDto>();
        foreach (var s in await ScheduleStore.ListAsync(conn, user))
        {
            await ScheduleStore.SyncAsync(conn, s, clock);
            list.Add(await ScheduleStore.DtoAsync(conn, s, clock, now));
        }
        return TypedResults.Ok(list.ToArray());
    }

    private static async Task<Results<Created<ScheduleDto>, ValidationProblem>> Create(ScheduleInput body, HttpContext http, ScheduleStore store, TimeProvider time)
    {
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        var clock = await ScheduleStore.ClockAsync(conn, user);
        var now = time.GetUtcNow().UtcDateTime;
        if (Clean(body, store, clock.Today(now)) is not { } c) return Invalid(Problem(body, store));
        await store.SeedOnceAsync(conn, user, clock, now); // a first schedule made by hand doesn't later get the starters beside it unseen
        var id = await conn.ExecuteScalarAsync<Guid>(
            """
            insert into schedules (user_id, title, area, match_text, every_days, at_minute, next_due, items, paused, rotation, weekdays, dose)
            values (@user, @Title, @Area, @Match, @EveryDays, @AtMinute, @NextDue::date, @Items, @Paused, @Rotation, coalesce(@Weekdays, '{}'), @Dose)
            returning id
            """,
            new { user, c.Title, c.Area, c.Match, c.EveryDays, c.AtMinute, c.NextDue, c.Items, c.Paused, c.Rotation, c.Weekdays, c.Dose });
        var s = (await ScheduleStore.GetAsync(conn, user, id))!;
        return TypedResults.Created($"/schedules/{id}", await ScheduleStore.DtoAsync(conn, s, clock, now));
    }

    private static async Task<Results<Ok<ScheduleDto>, NotFound, ValidationProblem>> Update(Guid id, ScheduleInput body, HttpContext http, ScheduleStore store, TimeProvider time)
    {
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        var clock = await ScheduleStore.ClockAsync(conn, user);
        var now = time.GetUtcNow().UtcDateTime;
        if (Clean(body, store, clock.Today(now)) is not { } c) return Invalid(Problem(body, store));
        // Changing the cadence or the date settles any "moved to Tuesday" question.
        var n = await conn.ExecuteAsync(
            """
            update schedules set title = @Title, area = @Area, match_text = @Match, every_days = @EveryDays, at_minute = @AtMinute,
              shifted_from = case when every_days = @EveryDays and next_due is not distinct from @NextDue::date then shifted_from end,
              next_due = @NextDue::date, items = @Items, paused = @Paused, rotation = @Rotation,
              weekdays = coalesce(@Weekdays, weekdays),
              dose_set_at = case when @Dose::text is not null and nullif(@Dose, '') is distinct from dose then now() else dose_set_at end,
              dose = case when @Dose::text is null then dose else nullif(@Dose, '') end,
              updated_at = now()
            where id = @id and user_id = @user
            """,
            new { id, user, c.Title, c.Area, c.Match, c.EveryDays, c.AtMinute, c.NextDue, c.Items, c.Paused, c.Rotation, c.Weekdays, c.Dose });
        if (n == 0) return TypedResults.NotFound();
        return TypedResults.Ok(await Fresh(conn, user, id, clock, now));
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HttpContext http, ScheduleStore store)
    {
        await using var conn = await store.Db.OpenAsync();
        var n = await conn.ExecuteAsync("delete from schedules where id = @id and user_id = @user", new { id, user = http.User.UserId() });
        return n == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    /// <summary>Log the dose now (an entry in the schedule's area), then return the schedule.</summary>
    private static async Task<Results<Ok<ScheduleDto>, NotFound, ValidationProblem>> Done(Guid id, HttpContext http, ScheduleStore store, TimeProvider time)
    {
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        if (await ScheduleStore.GetAsync(conn, user, id) is not { } s) return TypedResults.NotFound();
        var now = time.GetUtcNow().UtcDateTime;
        if (await store.LogDoseAsync(conn, s, now) is { } problem) return Invalid(problem);
        return TypedResults.Ok(await Fresh(conn, user, id, await ScheduleStore.ClockAsync(conn, user), now));
    }

    /// <summary>
    /// The doses that count for this schedule, newest first: its area's
    /// entries naming its medication (or, for a daily list, naming one of
    /// its items or the list), not "ran out" or "refilled".
    /// </summary>
    private static async Task<Results<Ok<EntryDto[]>, NotFound>> History(Guid id, HttpContext http, ScheduleStore store, Bo.Api.Areas.AreaCatalog catalog, int limit = 100)
    {
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        if (await ScheduleStore.GetAsync(conn, user, id) is not { } s) return TypedResults.NotFound();
        var names = s.ByItem ? s.Items.Select(ScheduleLogic.Name).Append(s.MatchText ?? "").Where(n => n.Length >= 3).ToArray() : [];
        var rows = await conn.QueryAsync<(Guid Id, string Area, DateTime At, string Data, string Source, string? Raw, DateTime CreatedAt)>(
            """
            select id, area, at, data::text, source, raw, created_at from entries
            where user_id = @user and area = @area
              and coalesce(data->>'event', 'taken') = 'taken'
              and (
                (@byItem and exists (select 1 from unnest(@names::text[]) n
                   where data->>'medication' ilike '%' || n || '%' or n ilike '%' || (data->>'medication') || '%'))
                or (not @byItem and (@match::text is null or data->>'medication' ilike '%' || @match || '%')))
            order by at desc limit @limit
            """,
            new { user, area = s.Area, byItem = s.ByItem, names, match = s.MatchText, limit = Math.Clamp(limit, 1, 500) });
        var area = catalog.Find(s.Area);
        return TypedResults.Ok(rows.Select(r =>
        {
            var data = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, System.Text.Json.JsonElement>>(r.Data) ?? [];
            var summary = area is null ? r.Area : Bo.Api.Areas.AreaCatalog.Summarize(area, data.ToDictionary(kv => kv.Key, kv => (object?)kv.Value));
            return new EntryDto(r.Id, r.Area, r.At, data, summary, r.Source, r.Raw, r.CreatedAt);
        }).ToArray());
    }

    /// <summary>Tick one item of a daily list: taken, open (untick), skipped, or later with a time to remind.</summary>
    private static async Task<Results<Ok<ScheduleDto>, NotFound, ValidationProblem>> SetItem(Guid id, ItemInput body, HttpContext http, ScheduleStore store, TimeProvider time)
    {
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        if (await ScheduleStore.GetAsync(conn, user, id) is not { } s) return TypedResults.NotFound();
        var clock = await ScheduleStore.ClockAsync(conn, user);
        var now = time.GetUtcNow().UtcDateTime;
        if (await store.SetItemAsync(conn, s, body.Item, body.State, body.RemindAt?.UtcDateTime, clock, now) is { } problem) return Invalid(problem);
        return TypedResults.Ok(await Fresh(conn, user, id, clock, now));
    }

    /// <summary>Put today's nudge off for a while (default an hour). Nudges only; it's still due.</summary>
    private static async Task<Results<Ok<ScheduleDto>, NotFound>> Snooze(Guid id, SnoozeInput body, HttpContext http, ScheduleStore store, TimeProvider time)
    {
        var user = http.User.UserId();
        var now = time.GetUtcNow().UtcDateTime;
        await using var conn = await store.Db.OpenAsync();
        var n = await conn.ExecuteAsync("update schedules set snoozed_until = @until where id = @id and user_id = @user",
            new { id, user, until = now.AddMinutes(Math.Clamp(body.Minutes, 5, 720)) });
        if (n == 0) return TypedResults.NotFound();
        return TypedResults.Ok(await Fresh(conn, user, id, await ScheduleStore.ClockAsync(conn, user), now));
    }

    /// <summary>A dose moved the cadence; go back to the planned day ("keep Mondays").</summary>
    private static async Task<Results<Ok<ScheduleDto>, NotFound, ValidationProblem>> KeepDay(Guid id, HttpContext http, ScheduleStore store, TimeProvider time)
    {
        var user = http.User.UserId();
        var now = time.GetUtcNow().UtcDateTime;
        await using var conn = await store.Db.OpenAsync();
        if (await ScheduleStore.GetAsync(conn, user, id) is not { } s) return TypedResults.NotFound();
        if (s.ShiftedFrom is null || s.LastEntryAt is not { } last) return Invalid("Nothing moved, so there's nothing to keep.");
        var clock = await ScheduleStore.ClockAsync(conn, user);
        var next = ScheduleLogic.KeepRhythm(s, clock.Today(last));
        await conn.ExecuteAsync("update schedules set next_due = @next::date, shifted_from = null, updated_at = now() where id = @id",
            new { id, next = ScheduleLogic.Iso(next) });
        return TypedResults.Ok(await Fresh(conn, user, id, clock, now));
    }

    /// <summary>A dose moved the cadence and that's fine: stop asking.</summary>
    private static async Task<Results<Ok<ScheduleDto>, NotFound>> AcceptDay(Guid id, HttpContext http, ScheduleStore store, TimeProvider time)
    {
        var user = http.User.UserId();
        await using var conn = await store.Db.OpenAsync();
        var n = await conn.ExecuteAsync("update schedules set shifted_from = null, updated_at = now() where id = @id and user_id = @user", new { id, user });
        if (n == 0) return TypedResults.NotFound();
        return TypedResults.Ok(await Fresh(conn, user, id, await ScheduleStore.ClockAsync(conn, user), time.GetUtcNow().UtcDateTime));
    }

    private static async Task<ScheduleDto> Fresh(NpgsqlConnection conn, Guid user, Guid id, Clock clock, DateTime now)
    {
        var s = (await ScheduleStore.GetAsync(conn, user, id))!;
        await ScheduleStore.SyncAsync(conn, s, clock);
        return await ScheduleStore.DtoAsync(conn, s, clock, now);
    }

    private sealed record Cleaned(string Title, string Area, string? Match, int EveryDays, int AtMinute, string? NextDue, string[] Items, bool Paused, string[] Rotation, int[]? Weekdays, string? Dose);

    private static Cleaned? Clean(ScheduleInput b, ScheduleStore store, DateOnly today)
    {
        if (Problem(b, store) is not null) return null;
        var every = b.EveryDays;
        var next = every > 1 ? ScheduleLogic.Iso(ScheduleLogic.Day(b.NextDue) ?? today) : null;
        var items = (b.Items ?? []).Select(i => i.Trim()).Where(i => i.Length > 0).Select(i => i.Length > 80 ? i[..80] : i).Take(40).ToArray();
        var match = b.Match?.Trim() is { Length: > 0 } m ? m : null;
        var rotation = (b.Rotation ?? []).Select(r => r.Trim()).Where(r => r.Length > 0).Distinct().ToArray();
        // Weekdays only mean something on a daily schedule; all seven is the same as none.
        int[]? weekdays = null;
        if (b.Weekdays is not null)
        {
            var days = b.Weekdays.Where(d => d is >= 0 and <= 6).Distinct().Order().ToArray();
            weekdays = every > 1 || days.Length == 7 ? [] : days;
        }
        var dose = b.Dose is null ? null : b.Dose.Trim() is { Length: > 0 } d ? (d.Length > 60 ? d[..60] : d) : "";
        return new Cleaned(b.Title.Trim(), b.Area, match, every, ScheduleLogic.Minute(b.At)!.Value, next, items, b.Paused, rotation, weekdays, dose);
    }

    private static string? Problem(ScheduleInput b, ScheduleStore store) =>
        string.IsNullOrWhiteSpace(b.Title) ? "Give it a name."
        : !store.IsLogArea(b.Area) ? $"No area \"{b.Area}\"."
        : b.EveryDays is < 1 or > 365 ? "Every 1 to 365 days."
        : ScheduleLogic.Minute(b.At) is null ? "Time should be HH:mm."
        : b.NextDue is { Length: > 0 } && ScheduleLogic.Day(b.NextDue) is null ? "Next date should be yyyy-MM-dd."
        : store.RotationProblem(b.Area, b.Rotation ?? []);

    private static ValidationProblem Invalid(string? message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["schedule"] = [message ?? "Not valid."] });
}
