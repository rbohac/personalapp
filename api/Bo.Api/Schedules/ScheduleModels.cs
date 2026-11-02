namespace Bo.Api.Schedules;

/// <summary>
/// A schedule as the app sees it: what it is, plus where it stands right now.
/// </summary>
/// <param name="EveryDays">1 = daily; 7 = weekly, counted from the last dose.</param>
/// <param name="At">Local time it's due, "HH:mm".</param>
/// <param name="NextDue">Every-N-days only: the day the next dose is due (yyyy-MM-dd).</param>
/// <param name="ShiftedFrom">Set when the last dose was on another day than planned, so the cadence moved: the day it had been planned for.</param>
/// <param name="Status">What the app shows. See <see cref="ScheduleStatus"/>.</param>
/// <param name="Rotation">Sites to alternate, in order (shots).</param>
/// <param name="NextSite">The site for the next dose: the one after the last dose's. Null without a rotation.</param>
public record ScheduleDto(
    Guid Id, string Title, string Area, string? Match, int EveryDays, string At, string? NextDue,
    string? ShiftedFrom, string[] Items, bool Paused, DateTime? SnoozedUntil, DateTime? LastDoneAt, ScheduleStatus Status,
    ItemMark[] Today, string[] Rotation, string? NextSite);

/// <summary>
/// One item of a daily schedule's list, today. State is open (still to take),
/// taken, skipped, or later (a reminder is set for <see cref="RemindAt"/>).
/// </summary>
/// <param name="ByEntry">Taken because a logged entry names it (said or typed), not ticked here.</param>
public record ItemMark(string Item, string State, DateTime? RemindAt, bool ByEntry);

/// <summary>Tick one item: taken, open (untick), skipped, or later (needs RemindAt).</summary>
public record ItemInput(string Item, string State, DateTimeOffset? RemindAt = null);

/// <param name="State">done (today's is logged), later (due later today), due, overdue, upcoming (a later day), paused.</param>
/// <param name="DueAt">When the current or next dose is due (UTC).</param>
/// <param name="DaysLate">Overdue only.</param>
public record ScheduleStatus(string State, DateTime? DueAt, int DaysLate, string Label);

/// <summary>A new or edited schedule. The whole form, every time.</summary>
public record ScheduleInput(
    string Title, string Area, int EveryDays, string At, string? Match = null, string? NextDue = null,
    string[]? Items = null, bool Paused = false, string[]? Rotation = null);

/// <summary>How long to put off today's nudge.</summary>
public record SnoozeInput(int Minutes = 60);

public record TimeZoneInput(string TimeZone);

/// <summary>A schedule row as stored.</summary>
internal sealed class ScheduleRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Title { get; set; } = "";
    public string Area { get; set; } = "";
    public string? MatchText { get; set; }
    public int EveryDays { get; set; }
    public int AtMinute { get; set; }
    public string? NextDue { get; set; }
    public string? ShiftedFrom { get; set; }
    public DateTime? LastEntryAt { get; set; }
    public string[] Items { get; set; } = [];
    public string[] Rotation { get; set; } = [];
    public bool Paused { get; set; }
    public DateTime? SnoozedUntil { get; set; }
    public DateTime CreatedAt { get; set; }

    public const string Columns =
        "id, user_id as userid, title, area, match_text as matchtext, every_days as everydays, at_minute as atminute, " +
        "next_due::text as nextdue, shifted_from::text as shiftedfrom, last_entry_at as lastentryat, items, rotation, paused, " +
        "snoozed_until as snoozeduntil, created_at as createdat";

    public bool Daily => EveryDays == 1;
    /// <summary>A daily schedule with a list is ticked off item by item.</summary>
    public bool ByItem => Daily && Items.Length > 0;
}

/// <summary>A person's clock: zone and quiet hours.</summary>
internal sealed record Clock(TimeZoneInfo Zone, int QuietStartMinute, int QuietEndMinute)
{
    public DateOnly Today(DateTime utcNow) => DateOnly.FromDateTime(Local(utcNow));
    public DateTime Local(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Zone);

    /// <summary>A local day and minute, as UTC.</summary>
    public DateTime Utc(DateOnly day, int minute) =>
        TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(new TimeOnly(minute / 60, minute % 60)), Zone);

    public DateTime StartOfToday(DateTime utcNow) => Utc(Today(utcNow), 0);

    /// <summary>Quiet hours wrap midnight: 22:00–07:30.</summary>
    public bool Quiet(DateTime utcNow)
    {
        var l = Local(utcNow);
        var m = l.Hour * 60 + l.Minute;
        return QuietStartMinute > QuietEndMinute
            ? m >= QuietStartMinute || m < QuietEndMinute
            : m >= QuietStartMinute && m < QuietEndMinute;
    }

    public static TimeZoneInfo ZoneOr(string? id, TimeZoneInfo fallback) =>
        id is { Length: > 0 } && TimeZoneInfo.TryFindSystemTimeZoneById(id, out var z) ? z : fallback;
}
