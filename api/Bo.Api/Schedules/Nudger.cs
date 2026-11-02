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
public sealed class Nudger(Db db, ExpoPush push, TimeProvider time, ILogger<Nudger> log) : BackgroundService
{
    public const string Category = "bo.schedule";
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
    }

    /// <summary>
    /// The pushes this schedule could owe right now, each keyed by (day, kind).
    /// The caller sends the ones not already sent: a note about a moved
    /// cadence, and at most one reminder.
    /// </summary>
    private static IEnumerable<(string Day, string Kind, PushMessage Message)> Owed(ScheduleRow s, ScheduleDto d, Clock clock, DateTime now)
    {
        var today = ScheduleLogic.Iso(clock.Today(now));
        var items = s.Items.Length > 0 ? string.Join(", ", s.Items) : null;
        var data = new { kind = "schedule", scheduleId = s.Id };

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

        // Each kind is claimed once per day. A snooze replaces the follow-up.
        if (snoozedToday)
            yield return (today, $"snooze-{s.SnoozedUntil:HHmm}", new PushMessage(s.Title, body, data, Category));
        else if (now >= dueAt + FollowUpAfter)
            yield return (today, "followup", new PushMessage($"Still to do: {s.Title}", body, data, Category));
        else
            yield return (today, "due", new PushMessage(s.Title, body, data, Category));
    }
}
