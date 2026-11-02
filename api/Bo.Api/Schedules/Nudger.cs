using Bo.Api.Data;
using Dapper;
using Npgsql;

namespace Bo.Api.Schedules;

/// <summary>
/// Every five minutes: for each person with a phone registered, bring each
/// schedule up to date and send what's owed — the nudge at the due time, one
/// follow-up two hours later, the snoozed one when its snooze ends, and a
/// note when a late dose moved the cadence. Never during quiet hours.
/// schedule_nudges records each push, so a restart or an overlapping run
/// never sends one twice.
/// </summary>
public sealed class Nudger(Db db, ExpoPush push, Goals.GoalStore goals, TimeProvider time, ILogger<Nudger> log) : BackgroundService
{
    public const string Category = "bo.schedule";
    /// <summary>A daily list's nudge: "Took all" instead of "Done".</summary>
    public const string ListCategory = "bo.schedule.list";
    /// <summary>A reminder for one put-off item: "Took it" / "In 1 hour".</summary>
    public const string ItemCategory = "bo.item";
    private static readonly TimeSpan FollowUpAfter = TimeSpan.FromHours(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5), time);
        do
        {
            try { await RunOnceAsync(stoppingToken); }
            catch (Exception e) when (e is not OperationCanceledException) { log.LogWarning(e, "Schedule nudges failed; will retry."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var users = await conn.QueryAsync<Guid>(
            "select distinct u.id from users u join push_devices d on d.user_id = u.id join schedules s on s.user_id = u.id where u.time_zone is not null");
        foreach (var user in users)
        {
            var clock = await ScheduleStore.ClockAsync(conn, user);
            var tokens = (await conn.QueryAsync<string>("select expo_token from push_devices where user_id = @user", new { user })).ToList();
            foreach (var s in await ScheduleStore.ListAsync(conn, user))
            {
                if (s.Paused) continue;
                await ScheduleStore.SyncAsync(conn, s, clock);
                var now = time.GetUtcNow().UtcDateTime;
                if (clock.Quiet(now)) continue;
                var dto = await ScheduleStore.DtoAsync(conn, s, clock, now);
                foreach (var (day, kind, message) in Owed(s, dto, clock, now))
                {
                    // Claim before sending: a second run racing this one finds the row and stays quiet.
                    var claimed = await conn.ExecuteAsync(
                        "insert into schedule_nudges (schedule_id, day, kind) values (@id, @day::date, @kind) on conflict do nothing",
                        new { s.Id, day, kind });
                    if (claimed == 0) continue;
                    var gone = await push.SendAsync(tokens, message, ct);
                    if (gone.Length > 0)
                    {
                        await conn.ExecuteAsync("delete from push_devices where expo_token = any(@gone)", new { gone });
                        tokens.RemoveAll(gone.Contains);
                    }
                }
            }
        }
        await RemindItemsAsync(conn, ct);
        await WeeklyGoalsAsync(conn, ct);
    }

    /// <summary>The Thursday check and the Sunday summary, once each per week per person.</summary>
    private async Task WeeklyGoalsAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        var users = await conn.QueryAsync<Guid>(
            "select distinct u.id from users u join push_devices d on d.user_id = u.id join goals g on g.user_id = u.id where u.time_zone is not null");
        foreach (var user in users)
        {
            var clock = await ScheduleStore.ClockAsync(conn, user);
            if (await goals.WeeklyPushAsync(conn, user, clock, time.GetUtcNow().UtcDateTime) is not { } owed) continue;
            var (kind, week, message) = owed;
            var claimed = await conn.ExecuteAsync(
                "insert into goal_nudges (user_id, week, kind) values (@user, @week::date, @kind) on conflict do nothing", new { user, week, kind });
            if (claimed == 0) continue;
            var tokens = (await conn.QueryAsync<string>("select expo_token from push_devices where user_id = @user", new { user })).ToList();
            var gone = await push.SendAsync(tokens, message, ct);
            if (gone.Length > 0) await conn.ExecuteAsync("delete from push_devices where expo_token = any(@gone)", new { gone });
        }
    }

    private sealed record DueItem(Guid ScheduleId, Guid UserId, string Title, string Item, string Day);

    /// <summary>
    /// Items put off with "remind me later": ring at the time asked for, once.
    /// Quiet hours don't apply — the time was chosen on purpose.
    /// </summary>
    private async Task RemindItemsAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        // Claim and read in one statement, so a racing run can't send it too.
        var due = await conn.QueryAsync<DueItem>(
            """
            update schedule_marks m set reminded_at = now()
            from schedules s
            where m.schedule_id = s.id and m.state = 'later' and m.reminded_at is null and m.remind_at <= now()
            returning m.schedule_id as scheduleid, s.user_id as userid, s.title, m.item, m.day::text as day
            """);
        foreach (var d in due)
        {
            var tokens = (await conn.QueryAsync<string>("select expo_token from push_devices where user_id = @u", new { u = d.UserId })).ToList();
            var gone = await push.SendAsync(tokens, new PushMessage(
                $"Time to take {ScheduleLogic.Name(d.Item)}",
                $"You put it off from {d.Title}.",
                new { kind = "schedule-item", scheduleId = d.ScheduleId, item = d.Item },
                ItemCategory), ct);
            if (gone.Length > 0) await conn.ExecuteAsync("delete from push_devices where expo_token = any(@gone)", new { gone });
        }
    }

    private static string Cap(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];

    /// <summary>
    /// The pushes this schedule could owe right now, each keyed by (day, kind).
    /// The caller sends the ones not already sent: a note about a moved
    /// cadence, and at most one reminder.
    /// </summary>
    private static IEnumerable<(string Day, string Kind, PushMessage Message)> Owed(ScheduleRow s, ScheduleDto d, Clock clock, DateTime now)
    {
        var today = ScheduleLogic.Iso(clock.Today(now));
        var items = s.Items.Length > 0 ? string.Join(", ", s.Items) : null;
        object data = new { kind = "schedule", scheduleId = s.Id };

        // A late (or early) dose moved the cadence: say so, once per move.
        if (s.ShiftedFrom is { } from && ScheduleLogic.Day(s.NextDue) is { } next && ScheduleLogic.Day(from) is { } planned)
        {
            var newDay = ScheduleLogic.DayName(next);
            yield return (from, "shift", new PushMessage(
                $"{s.Title} moved to {newDay}s",
                $"You logged it on a {ScheduleLogic.DayName(next.AddDays(-s.EveryDays))}, so the next one is {next:ddd MMM d}. Open Bo to keep {ScheduleLogic.DayName(planned)}s instead.",
                new { kind = "schedule-shift", scheduleId = s.Id }));
        }

        if (d.Status.State is not ("due" or "overdue") || d.Status.DueAt is not { } dueAt) yield break;

        var snoozedToday = s.SnoozedUntil is { } su && su >= clock.StartOfToday(now);
        if (snoozedToday && s.SnoozedUntil > now) yield break;

        var lateNote = d.Status.State == "overdue" ? $"{d.Status.Label}. " : "";
        var body = lateNote + (items ?? (s.Daily ? "Due now." : "Due today."));
        if (d.NextSite is { } site) body = $"{lateNote}{Cap(ScheduleStore.SiteLabel(site))} this time.{(items is null ? "" : " " + items)}";
        var category = Category;
        if (s.ByItem)
        {
            // Name what's left; once some are ticked, the rest is the news.
            var left = d.Today.Where(m => m.State == "open").Select(m => m.Item).ToArray();
            var partial = left.Length < d.Today.Length;
            body = partial ? $"Not taken yet: {string.Join(", ", left)}. Tap to tick it off or pick a time." : string.Join(", ", left);
            category = ListCategory;
            data = new { kind = "schedule", scheduleId = s.Id, ask = partial };
        }

        // Each kind is claimed once per day. A snooze replaces the follow-up.
        if (snoozedToday)
            yield return (today, $"snooze-{s.SnoozedUntil:HHmm}", new PushMessage(s.Title, body, data, category));
        else if (now >= dueAt + FollowUpAfter)
            yield return (today, "followup", new PushMessage($"Still to do: {s.Title}", body, s.ByItem ? new { kind = "schedule", scheduleId = s.Id, ask = true } : data, category));
        else
            yield return (today, "due", new PushMessage(s.Title, body, data, category));
    }
}
