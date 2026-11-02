using System.Text.Json;
using Bo.Api.Areas;
using Bo.Api.Data;
using Dapper;
using Npgsql;

namespace Bo.Api.Schedules;

/// <summary>
/// Schedules in the database, and the one place a logged entry is matched to
/// a schedule. Used by the endpoints and by the nudger, so the app and the
/// pushes always agree about what's due.
/// </summary>
public sealed class ScheduleStore(Db db, AreaCatalog catalog)
{
    internal Db Db => db;

    internal static async Task<Clock> ClockAsync(NpgsqlConnection conn, Guid user)
    {
        var u = await conn.QuerySingleAsync<(string? Zone, int QuietStart, int QuietEnd)>(
            "select time_zone, quiet_start_minute, quiet_end_minute from users where id = @user", new { user });
        return new Clock(Clock.ZoneOr(u.Zone, TimeZoneInfo.Utc), u.QuietStart, u.QuietEnd);
    }

    /// <summary>The phone reports its zone; nudges are timed by it.</summary>
    internal static Task SetZoneAsync(NpgsqlConnection conn, Guid user, string? zone) =>
        zone is { Length: > 0 } && TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _)
            ? conn.ExecuteAsync("update users set time_zone = @zone where id = @user and time_zone is distinct from @zone", new { user, zone })
            : Task.CompletedTask;

    /// <summary>Copy areas/_schedules.json in, once per person.</summary>
    internal async Task SeedOnceAsync(NpgsqlConnection conn, Guid user, Clock clock, DateTime utcNow)
    {
        await using var tx = await conn.BeginTransactionAsync();
        var claimed = await conn.ExecuteAsync("update users set schedules_seeded = true where id = @user and not schedules_seeded", new { user }, tx);
        if (claimed == 1)
        {
            var today = clock.Today(utcNow);
            foreach (var s in catalog.StarterSchedules)
                await conn.ExecuteAsync(
                    """
                    insert into schedules (user_id, title, area, match_text, every_days, at_minute, next_due, items, rotation)
                    values (@user, @title, @area, @match, @every, @at, @next::date, @items, @rotation)
                    """,
                    new
                    {
                        user, title = s.Title, area = s.Area, match = s.Match, every = s.EveryDays,
                        at = ScheduleLogic.Minute(s.At) ?? 480,
                        next = s.EveryDays > 1 ? ScheduleLogic.Iso(ScheduleLogic.StartDay(s.Start, today)) : null,
                        items = s.Items, rotation = s.Rotation,
                    }, tx);
        }
        await tx.CommitAsync();
    }

    internal static async Task<List<ScheduleRow>> ListAsync(NpgsqlConnection conn, Guid user) =>
        (await conn.QueryAsync<ScheduleRow>(
            $"select {ScheduleRow.Columns} from schedules where user_id = @user order by every_days, at_minute, lower(title)", new { user })).ToList();

    internal static Task<ScheduleRow?> GetAsync(NpgsqlConnection conn, Guid user, Guid id) =>
        conn.QuerySingleOrDefaultAsync<ScheduleRow>($"select {ScheduleRow.Columns} from schedules where id = @id and user_id = @user", new { id, user });

    /// <summary>
    /// The newest entry that counts for this schedule, at or after <paramref name="since"/>:
    /// the schedule's area, a medication containing its match text when it
    /// has one, and not a "ran out" or "refilled" shot.
    /// </summary>
    internal static Task<DateTime?> LatestDoseAsync(NpgsqlConnection conn, ScheduleRow s, DateTime? since = null) =>
        conn.ExecuteScalarAsync<DateTime?>(
            """
            select max(at) from entries
            where user_id = @user and area = @area
              and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
              and coalesce(data->>'event', 'taken') = 'taken'
              and (@since::timestamptz is null or at >= @since)
            """,
            new { user = s.UserId, area = s.Area, match = Escape(s.MatchText), since });

    /// <summary>
    /// The site for the next dose: the one after the newest dose that logged
    /// a site in the rotation (a dose with no side said doesn't move it). The
    /// first in the list when none has.
    /// </summary>
    internal static async Task<string?> NextSiteAsync(NpgsqlConnection conn, ScheduleRow s)
    {
        if (s.Rotation.Length == 0) return null;
        var last = await conn.ExecuteScalarAsync<string?>(
            """
            select data->>'site' from entries
            where user_id = @user and area = @area
              and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
              and coalesce(data->>'event', 'taken') = 'taken'
              and data->>'site' = any(@rotation)
            order by at desc limit 1
            """,
            new { user = s.UserId, area = s.Area, match = Escape(s.MatchText), rotation = s.Rotation });
        var i = last is null ? -1 : Array.IndexOf(s.Rotation, last);
        return s.Rotation[(i + 1) % s.Rotation.Length];
    }

    /// <summary>"left-thigh" → "left thigh".</summary>
    internal static string SiteLabel(string site) => site.Replace('-', ' ');

    private static string? Escape(string? m) =>
        m is { Length: > 0 } ? m.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_") : null;

    /// <summary>
    /// Move an every-N-days schedule past any dose logged since the last one
    /// counted. Returns true when the dose landed off the planned day (the
    /// cadence moved; <c>shifted_from</c> records the old day).
    /// </summary>
    internal static async Task<bool> SyncAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock)
    {
        if (s.Daily) return false;
        var since = s.LastEntryAt ?? s.CreatedAt;
        var dose = await conn.ExecuteScalarAsync<DateTime?>(
            """
            select max(at) from entries
            where user_id = @user and area = @area
              and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
              and coalesce(data->>'event', 'taken') = 'taken'
              and at > @since
            """,
            new { user = s.UserId, area = s.Area, match = Escape(s.MatchText), since });
        if (dose is null) return false;

        var (next, shifted) = ScheduleLogic.AfterDose(s, clock.Today(dose.Value));
        await conn.ExecuteAsync(
            """
            update schedules set next_due = @next::date, shifted_from = @shifted::date, last_entry_at = @dose,
              snoozed_until = null, updated_at = now()
            where id = @id
            """,
            new { s.Id, next = ScheduleLogic.Iso(next), shifted = shifted is { } d ? ScheduleLogic.Iso(d) : null, dose });
        s.NextDue = ScheduleLogic.Iso(next);
        s.ShiftedFrom = shifted is { } x ? ScheduleLogic.Iso(x) : null;
        s.LastEntryAt = dose;
        s.SnoozedUntil = null;
        return shifted is not null;
    }

    /// <summary>The schedule as the app sees it. Assumes <see cref="SyncAsync"/> has run.</summary>
    internal static async Task<ScheduleDto> DtoAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock, DateTime utcNow)
    {
        var last = await LatestDoseAsync(conn, s);
        ItemMark[] marks = [];
        ScheduleStatus status;
        if (s.ByItem)
        {
            marks = await MarksAsync(conn, s, clock, utcNow);
            status = ScheduleLogic.StatusOfList(s, clock, utcNow, marks);
        }
        else
        {
            var doneToday = s.Daily && last is { } l && l >= clock.StartOfToday(utcNow) ? last : null;
            status = ScheduleLogic.StatusOf(s, clock, utcNow, doneToday);
        }
        return new ScheduleDto(s.Id, s.Title, s.Area, s.MatchText, s.EveryDays, ScheduleLogic.Hhmm(s.AtMinute), s.NextDue,
            s.ShiftedFrom, s.Items, s.Paused, s.SnoozedUntil, last, status, marks, s.Rotation, await NextSiteAsync(conn, s));
    }

    private sealed record MarkRow(string Item, string State, Guid? EntryId, DateTime? RemindAt);

    /// <summary>
    /// Today's state of each item on a daily list: its tick if it has one;
    /// otherwise taken if an entry logged today names it (or names the whole
    /// list, "took my morning meds"); otherwise still open.
    /// </summary>
    internal static async Task<ItemMark[]> MarksAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock, DateTime utcNow)
    {
        var rows = (await conn.QueryAsync<MarkRow>(
            "select item, state, entry_id as entryid, remind_at as remindat from schedule_marks where schedule_id = @id and day = @day::date",
            new { s.Id, day = ScheduleLogic.Iso(clock.Today(utcNow)) })).ToDictionary(r => r.Item);
        var linked = rows.Values.Where(r => r.EntryId is not null).Select(r => r.EntryId!.Value).ToHashSet();
        var said = (await conn.QueryAsync<(Guid Id, string? Medication)>(
            """
            select id, data->>'medication' from entries
            where user_id = @user and area = @area and at >= @start and coalesce(data->>'event', 'taken') = 'taken'
            """,
            new { user = s.UserId, area = s.Area, start = clock.StartOfToday(utcNow) }))
            .Where(e => !linked.Contains(e.Id)).Select(e => e.Medication).ToList();
        var wholeList = s.MatchText is { Length: > 0 } m && said.Any(x => x?.Contains(m, StringComparison.OrdinalIgnoreCase) == true);

        return s.Items.Select(item =>
            rows.TryGetValue(item, out var r) ? new ItemMark(item, r.State, r.RemindAt, false)
            : wholeList || said.Any(x => ScheduleLogic.Names(x, item)) ? new ItemMark(item, "taken", null, true)
            : new ItemMark(item, "open", null, false)).ToArray();
    }

    /// <summary>
    /// Tick one item of a daily list. Taken logs an entry for it (and
    /// unticking removes that entry); skipped and later log nothing. Returns a
    /// problem in words, or null.
    /// </summary>
    internal async Task<string?> SetItemAsync(NpgsqlConnection conn, ScheduleRow s, string item, string state, DateTime? remindAt, Clock clock, DateTime utcNow)
    {
        if (!s.ByItem || !s.Items.Contains(item)) return $"\"{item}\" isn't on this list.";
        if (state is not ("taken" or "open" or "skipped" or "later")) return "State is taken, open, skipped or later.";
        if (state == "later" && (remindAt is null || remindAt <= utcNow)) return "Pick a time later than now.";
        var day = ScheduleLogic.Iso(clock.Today(utcNow));

        await using var tx = await conn.BeginTransactionAsync();
        var existing = await conn.QuerySingleOrDefaultAsync<MarkRow>(
            "select item, state, entry_id as entryid, remind_at as remindat from schedule_marks where schedule_id = @id and day = @day::date and item = @item",
            new { s.Id, day, item }, tx);
        if (existing?.State == "taken" && state == "taken") { await tx.CommitAsync(); return null; }
        if (existing?.EntryId is { } old)
            await conn.ExecuteAsync("delete from entries where id = @old and user_id = @user", new { old, user = s.UserId }, tx);

        if (state == "open")
        {
            await conn.ExecuteAsync("delete from schedule_marks where schedule_id = @id and day = @day::date and item = @item", new { s.Id, day, item }, tx);
            await tx.CommitAsync();
            return null;
        }

        Guid? entryId = null;
        if (state == "taken")
        {
            var area = catalog.Find(s.Area);
            if (area is null) return $"No area \"{s.Area}\".";
            var raw = new Dictionary<string, string?> { ["medication"] = ScheduleLogic.Name(item) };
            if (area.Fields.Any(f => f.Key == "event")) raw["event"] = "taken";
            var (data, problems) = catalog.Validate(area, raw);
            if (problems.Count > 0) return string.Join(" ", problems);
            entryId = await conn.ExecuteScalarAsync<Guid>(
                "insert into entries (user_id, area, at, data, source, raw) values (@user, @area, @at, @data::jsonb, 'manual', @raw) returning id",
                new { user = s.UserId, area = s.Area, at = utcNow, data = JsonSerializer.Serialize(data), raw = $"Ticked: {item}" }, tx);
        }
        await conn.ExecuteAsync(
            """
            insert into schedule_marks (schedule_id, day, item, state, entry_id, remind_at)
            values (@id, @day::date, @item, @state, @entryId, @remindAt)
            on conflict (schedule_id, day, item) do update
              set state = excluded.state, entry_id = excluded.entry_id, remind_at = excluded.remind_at,
                  reminded_at = null, updated_at = now()
            """,
            new { s.Id, day, item, state, entryId, remindAt = state == "later" ? remindAt : null }, tx);
        await tx.CommitAsync();
        return null;
    }

    /// <summary>
    /// "Done" from the app or a notification: log the entry the schedule
    /// would have matched, so the history reads the same as saying it.
    /// </summary>
    internal async Task<string?> LogDoseAsync(NpgsqlConnection conn, ScheduleRow s, DateTime utcNow)
    {
        // A list: "Took all" ticks every item still open, one entry each.
        if (s.ByItem)
        {
            var clock = await ClockAsync(conn, s.UserId);
            foreach (var m in await MarksAsync(conn, s, clock, utcNow))
                if (m.State is "open" or "later" && await SetItemAsync(conn, s, m.Item, "taken", null, clock, utcNow) is { } p) return p;
            return null;
        }
        var area = catalog.Find(s.Area);
        if (area is null) return $"No area \"{s.Area}\".";
        var raw = new Dictionary<string, string?> { ["medication"] = s.MatchText ?? s.Title };
        if (area.Fields.Any(f => f.Key == "event")) raw["event"] = "taken";
        // Done on a rotating shot logs the side it was due on.
        if (await NextSiteAsync(conn, s) is { } site) raw["site"] = site;
        var (data, problems) = catalog.Validate(area, raw);
        if (problems.Count > 0) return string.Join(" ", problems);
        await conn.ExecuteAsync(
            "insert into entries (user_id, area, at, data, source, raw) values (@user, @area, @at, @data::jsonb, 'manual', @raw)",
            new { user = s.UserId, area = s.Area, at = utcNow, data = JsonSerializer.Serialize(data), raw = $"Done: {s.Title}" });
        return null;
    }

    internal bool IsLogArea(string id) => catalog.Find(id) is { Kind: "log" };

    internal string? RotationProblem(string area, string[] rotation) =>
        catalog.Find(area) is { } a ? AreaCatalog.RotationProblem(a, rotation) : null;
}
