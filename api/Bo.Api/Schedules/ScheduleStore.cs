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
                    insert into schedules (user_id, title, area, match_text, every_days, at_minute, next_due, items, rotation, intervals, heads_up_days)
                    values (@user, @title, @area, @match, @every, @at, @next::date, @items, @rotation, @intervals, @headsUp)
                    """,
                    new
                    {
                        user, title = s.Title, area = s.Area, match = s.Match, every = s.EveryDays,
                        at = ScheduleLogic.Minute(s.At) ?? 480,
                        next = s.EveryDays > 1 ? ScheduleLogic.Iso(ScheduleLogic.StartDay(s.Start, today)) : null,
                        items = s.Items, rotation = s.Rotation, intervals = s.Intervals, headsUp = s.HeadsUpDays,
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
    /// has one, and not a "ran out" or "refilled" shot. With a
    /// <paramref name="window"/> (one of several daily schedules on the same
    /// medicine), only its own Done entries and doses said in its part of the day.
    /// </summary>
    internal static Task<DateTime?> LatestDoseAsync(NpgsqlConnection conn, ScheduleRow s, DateTime? since = null, DoseWindow? window = null) =>
        conn.ExecuteScalarAsync<DateTime?>(
            """
            select max(at) from entries
            where user_id = @user and area = @area
              and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
              and coalesce(data->>'event', 'taken') = 'taken'
              and (@since::timestamptz is null or at >= @since)
              and (not @windowed or schedule_id = @id or (schedule_id is null
                and extract(hour from at at time zone @zone) * 60 + extract(minute from at at time zone @zone) >= @start
                and extract(hour from at at time zone @zone) * 60 + extract(minute from at at time zone @zone) < @end))
            """,
            new
            {
                user = s.UserId, area = s.Area, match = Escape(s.MatchText), since, id = s.Id,
                windowed = window is not null, zone = window?.Zone ?? "UTC", start = window?.Start ?? 0, end = window?.End ?? 1440,
            });

    /// <summary>
    /// The part of the day a daily schedule's said doses belong to, when other
    /// daily schedules share its medicine (nose sprays at 10 AM and 10 PM): the
    /// day splits halfway between their times. Null when it's the only one.
    /// </summary>
    internal static async Task<DoseWindow?> WindowAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock)
    {
        if (!s.Daily || s.ByItem || s.MatchText is not { Length: > 0 } match) return null;
        var times = (await conn.QueryAsync<(Guid Id, int At)>(
            """
            select id, at_minute from schedules
            where user_id = @user and area = @area and every_days = 1 and cardinality(items) = 0
              and lower(match_text) = lower(@match)
            order by at_minute, id
            """,
            new { user = s.UserId, area = s.Area, match })).ToList();
        var i = times.FindIndex(t => t.Id == s.Id);
        if (times.Count < 2 || i < 0) return null;
        var start = i == 0 ? 0 : (times[i - 1].At + times[i].At) / 2;
        var end = i == times.Count - 1 ? 1440 : (times[i].At + times[i + 1].At) / 2;
        return new DoseWindow(start, end, clock.Zone.Id);
    }

    /// <summary>
    /// The site for the next dose: the one after the newest dose that logged
    /// a site in the rotation (a dose with no side said doesn't move it). The
    /// first in the list when none has.
    /// </summary>
    internal static async Task<string?> NextSiteAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock, DateTime utcNow)
    {
        if (s.Rotation.Length == 0) return null;
        var last = await LastFieldAsync(conn, s, "site", s.Rotation);
        var i = last is null ? -1 : Array.IndexOf(s.Rotation, last);
        var next = s.Rotation[(i + 1) % s.Rotation.Length];

        // Paired with another shot (sermorelin with tirzepatide): on a day the
        // other is given, take the opposite side to it. Its side today is the
        // one logged today, or the one it's due on if it's due today.
        if (s.OppositeOf is { } otherId && await GetAsync(conn, s.UserId, otherId) is { } other
            && await DoneTodayAsync(conn, s, clock, utcNow) is null)
        {
            var today = clock.Today(utcNow);
            var otherToday = await conn.ExecuteScalarAsync<string?>(
                """
                select data->>'site' from entries
                where user_id = @user and area = @area and at >= @start
                  and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
                  and coalesce(data->>'event', 'taken') = 'taken'
                order by at desc limit 1
                """,
                new { user = other.UserId, area = other.Area, match = Escape(other.MatchText), start = clock.StartOfToday(utcNow) });
            if (otherToday is null && ScheduleLogic.Day(other.NextDue) is { } due && due <= today)
                otherToday = await NextSiteAsync(conn, other, clock, utcNow);
            if (ScheduleLogic.Side(otherToday) is { } taken
                && s.Rotation.FirstOrDefault(r => ScheduleLogic.Side(r) is { } side && side != taken) is { } opposite)
                return opposite;
        }
        return next;
    }

    /// <summary>The newest value of a field on this schedule's doses (limited to <paramref name="among"/> when given).</summary>
    private static Task<string?> LastFieldAsync(NpgsqlConnection conn, ScheduleRow s, string field, string[]? among = null) =>
        conn.ExecuteScalarAsync<string?>(
            """
            select data->>@field from entries
            where user_id = @user and area = @area
              and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
              and coalesce(data->>'event', 'taken') = 'taken'
              and data->>@field is not null
              and (@among::text[] is null or data->>@field = any(@among))
            order by at desc limit 1
            """,
            new { user = s.UserId, area = s.Area, match = Escape(s.MatchText), field, among });

    private static async Task<DateTime?> DoneTodayAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock, DateTime utcNow) =>
        await LatestDoseAsync(conn, s, clock.StartOfToday(utcNow), await WindowAsync(conn, s, clock));

    /// <summary>
    /// The dose to take: whichever is newer of the last one logged (a
    /// self-adjusted dose follows what you said) and the one set on the schedule.
    /// </summary>
    internal static async Task<string?> NextDoseAsync(NpgsqlConnection conn, ScheduleRow s)
    {
        // A full shot (the week-long one) isn't the usual amount: skip it.
        var recent = await conn.QueryAsync<(string Dose, DateTime At)>(
            """
            select data->>'dose', at from entries
            where user_id = @user and area = @area
              and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
              and coalesce(data->>'event', 'taken') = 'taken' and data->>'dose' is not null
            order by at desc limit 10
            """,
            new { user = s.UserId, area = s.Area, match = Escape(s.MatchText) });
        (string Dose, DateTime At)? logged = recent.Where(r => !s.IsFull(r.Dose)).Select(r => ((string, DateTime)?)r).FirstOrDefault();
        if (logged is not { } l) return s.Dose;
        return s.Dose is not null && s.DoseSetAt is { } set && set > l.At ? s.Dose : l.Dose;
    }

    /// <summary>"left-thigh" → "left thigh".</summary>
    internal static string SiteLabel(string site) => site.Replace('-', ' ');

    /// <summary>A daily list's last dose: the newest entry naming one of its items, or the list itself.</summary>
    internal static Task<DateTime?> LatestOfListAsync(NpgsqlConnection conn, ScheduleRow s) =>
        conn.ExecuteScalarAsync<DateTime?>(
            """
            select max(at) from entries
            where user_id = @user and area = @area and coalesce(data->>'event', 'taken') = 'taken'
              and exists (select 1 from unnest(@names::text[]) n
                where data->>'medication' ilike '%' || n || '%' or n ilike '%' || (data->>'medication') || '%')
            """,
            new { user = s.UserId, area = s.Area, names = ListNames(s) });

    /// <summary>What a daily list's entries are matched by: each item's name and the list's own match text.</summary>
    internal static string[] ListNames(ScheduleRow s) =>
        s.ItemNames.Select(ScheduleLogic.Name).Append(s.MatchText ?? "").Where(n => n.Length >= 3).ToArray();

    private static string? Escape(string? m) =>
        m is { Length: > 0 } ? m.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_") : null;

    /// <summary>
    /// Move an every-N-days schedule past any dose logged since the last one
    /// counted. Returns true when the dose landed off the planned day (the
    /// cadence moved; <c>shifted_from</c> records the old day).
    /// </summary>
    internal static async Task<bool> SyncAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock)
    {
        if (s.Daily || s.Finished) return false;
        // Doses since the last one counted. A schedule with no date yet takes
        // any past dose, so logging "my Leqvio was June 3rd" starts it from June.
        // A new one with a date counts from a day before it was made, so a
        // dose taken that morning, before the schedule existed, still counts.
        DateTime? since = s.LastEntryAt ?? (s.NextDue is null ? null : s.CreatedAt.AddDays(-1));
        if (s.Cycles) return await SyncCycleAsync(conn, s, clock, since);
        var found = await conn.QuerySingleAsync<(DateTime? Dose, int Count)>(
            """
            select max(at), count(*)::int from entries
            where user_id = @user and area = @area
              and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
              and coalesce(data->>'event', 'taken') = 'taken'
              and (@since::timestamptz is null or at > @since)
            """,
            new { user = s.UserId, area = s.Area, match = Escape(s.MatchText), since });
        if (found.Dose is not { } dose) return false;

        var done = s.DosesDone + found.Count;
        var (next, shifted) = ScheduleLogic.AfterDose(s, clock.Today(dose), done);
        var nextIso = next is { } n ? ScheduleLogic.Iso(n) : null;
        var shiftedIso = shifted is { } d ? ScheduleLogic.Iso(d) : null;
        await conn.ExecuteAsync(
            """
            update schedules set next_due = @nextIso::date, shifted_from = @shiftedIso::date, last_entry_at = @dose,
              doses_done = @done, snoozed_until = null, updated_at = now()
            where id = @id
            """,
            new { s.Id, nextIso, shiftedIso, dose, done });
        s.NextDue = nextIso;
        s.ShiftedFrom = shiftedIso;
        s.LastEntryAt = dose;
        s.DosesDone = done;
        s.SnoozedUntil = null;
        return shifted is not null;
    }

    /// <summary>
    /// A schedule with repeating gaps (testosterone: 4 days, then 3). Each
    /// normal dose waits the next gap and moves the cycle on; a full dose waits
    /// every_days (a week) and leaves the cycle where it was. Counted from the
    /// dose, so a late one resets — the way the weekly ones work.
    /// </summary>
    private static async Task<bool> SyncCycleAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock, DateTime? since)
    {
        var doses = (await conn.QueryAsync<(DateTime At, string? Dose)>(
            """
            select at, data->>'dose' from entries
            where user_id = @user and area = @area
              and (@match::text is null or data->>'medication' ilike '%' || @match || '%' escape '\')
              and coalesce(data->>'event', 'taken') = 'taken'
              and (@since::timestamptz is null or at > @since)
            order by at
            """,
            new { user = s.UserId, area = s.Area, match = Escape(s.MatchText), since })).ToList();
        if (doses.Count == 0) return false;

        var pos = s.CyclePos;
        var gap = s.EveryDays;
        foreach (var d in doses)
        {
            if (s.IsFull(d.Dose)) gap = s.EveryDays;
            else { gap = s.Cycle[pos % s.Cycle.Length]; pos++; }
        }
        var last = doses[^1].At;
        var next = ScheduleLogic.Iso(clock.Today(last).AddDays(gap));
        var done = s.DosesDone + doses.Count;
        pos %= s.Cycle.Length;
        await conn.ExecuteAsync(
            """
            update schedules set next_due = @next::date, shifted_from = null, last_entry_at = @last,
              doses_done = @done, cycle_pos = @pos, snoozed_until = null, updated_at = now()
            where id = @id
            """,
            new { s.Id, next, last, done, pos });
        s.NextDue = next;
        s.ShiftedFrom = null;
        s.LastEntryAt = last;
        s.DosesDone = done;
        s.CyclePos = pos;
        s.SnoozedUntil = null;
        return false;
    }

    /// <summary>The schedule as the app sees it. Assumes <see cref="SyncAsync"/> has run.</summary>
    internal static async Task<ScheduleDto> DtoAsync(NpgsqlConnection conn, ScheduleRow s, Clock clock, DateTime utcNow)
    {
        var last = s.ByItem ? await LatestOfListAsync(conn, s) : await LatestDoseAsync(conn, s, null, await WindowAsync(conn, s, clock));
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
            s.ShiftedFrom, s.Items, s.Paused, s.SnoozedUntil, last, status, marks, s.Rotation,
            await NextSiteAsync(conn, s, clock, utcNow), await NextDoseAsync(conn, s), s.Weekdays,
            s.Cycle, s.DoseOptions, s.FullDose, s.NextGap);
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

        return s.ItemNames.Select(item =>
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
        if (!s.ByItem || !s.ItemNames.Contains(item)) return $"\"{item}\" isn't on this list.";
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
    internal async Task<string?> LogDoseAsync(NpgsqlConnection conn, ScheduleRow s, DateTime utcNow, string? dose = null)
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
        // Done on a rotating shot logs the side it was due on, and the dose.
        if (await NextSiteAsync(conn, s, await ClockAsync(conn, s.UserId), utcNow) is { } site) raw["site"] = site;
        // The amount picked when logging (0.4, 0.5, full), else the usual one.
        if (area.Fields.Any(f => f.Key == "dose") && (dose?.Trim() is { Length: > 0 } picked ? picked : await NextDoseAsync(conn, s)) is { } amount)
            raw["dose"] = amount;
        var (data, problems) = catalog.Validate(area, raw);
        if (problems.Count > 0) return string.Join(" ", problems);
        await conn.ExecuteAsync(
            "insert into entries (user_id, area, at, data, source, raw, schedule_id) values (@user, @area, @at, @data::jsonb, 'manual', @raw, @id)",
            new { user = s.UserId, area = s.Area, at = utcNow, data = JsonSerializer.Serialize(data), raw = $"Done: {s.Title}", id = s.Id });
        return null;
    }

    internal bool IsLogArea(string id) => catalog.Find(id) is { Kind: "log" };

    internal string? RotationProblem(string area, string[] rotation) =>
        catalog.Find(area) is { } a ? AreaCatalog.RotationProblem(a, rotation) : null;
}
