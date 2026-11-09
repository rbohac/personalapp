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
/// <param name="NextSite">The site for the next dose: the one after the last dose's, or opposite a paired shot's that day. Null without a rotation.</param>
/// <param name="NextDose">The dose to take: the last one logged, else the schedule's.</param>
/// <param name="Weekdays">Days a daily schedule is due (0 = Sunday); empty = every day.</param>
/// <param name="Cycle">Gaps (days) that repeat after a normal dose, e.g. [4, 3]; empty = EveryDays.</param>
/// <param name="DoseOptions">Amounts offered when logging a dose ("0.4 ml").</param>
/// <param name="FullDose">The full amount: logging it waits EveryDays instead of the next gap.</param>
/// <param name="NextGap">Days until the one after, if the next dose is a normal one.</param>
public record ScheduleDto(
    Guid Id, string Title, string Area, string? Match, int EveryDays, string At, string? NextDue,
    string? ShiftedFrom, string[] Items, bool Paused, DateTime? SnoozedUntil, DateTime? LastDoneAt, ScheduleStatus Status,
    ItemMark[] Today, string[] Rotation, string? NextSite, string? NextDose, int[] Weekdays,
    int[] Cycle, string[] DoseOptions, string? FullDose, int NextGap);

/// <summary>
/// One item of a daily schedule's list, today. State is open (still to take),
/// taken, skipped, or later (a reminder is set for <see cref="RemindAt"/>).
/// </summary>
/// <param name="ByEntry">Taken because a logged entry names it (said or typed), not ticked here.</param>
public record ItemMark(string Item, string State, DateTime? RemindAt, bool ByEntry);

/// <summary>Tick one item: taken, open (untick), skipped, or later (needs RemindAt).</summary>
public record ItemInput(string Item, string State, DateTimeOffset? RemindAt = null);

/// <param name="State">done (today's is logged), later (due later today), due, overdue, upcoming (a later day), paused, finished (a course is over).</param>
/// <param name="DueAt">When the current or next dose is due (UTC).</param>
/// <param name="DaysLate">Overdue only.</param>
public record ScheduleStatus(string State, DateTime? DueAt, int DaysLate, string Label);

/// <summary>A new or edited schedule. The whole form, every time; Weekdays, Dose, Cycle, DoseOptions and FullDose left null keep what's stored.</summary>
public record ScheduleInput(
    string Title, string Area, int EveryDays, string At, string? Match = null, string? NextDue = null,
    string[]? Items = null, bool Paused = false, string[]? Rotation = null, int[]? Weekdays = null, string? Dose = null,
    int[]? Cycle = null, string[]? DoseOptions = null, string? FullDose = null);

/// <summary>Done, optionally with the amount taken (else the usual dose).</summary>
public record DoneInput(string? Dose = null);

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
    public int[] Intervals { get; set; } = [];
    public int DosesDone { get; set; }
    public int HeadsUpDays { get; set; }
    public int[] Weekdays { get; set; } = [];
    public string? Dose { get; set; }
    public DateTime? DoseSetAt { get; set; }
    public Guid? OppositeOf { get; set; }
    public int[] Cycle { get; set; } = [];
    public int CyclePos { get; set; }
    public string[] DoseOptions { get; set; } = [];
    public string? FullDose { get; set; }
    public bool Paused { get; set; }
    public DateTime? SnoozedUntil { get; set; }
    public DateTime CreatedAt { get; set; }

    public const string Columns =
        "id, user_id as userid, title, area, match_text as matchtext, every_days as everydays, at_minute as atminute, " +
        "next_due::text as nextdue, shifted_from::text as shiftedfrom, last_entry_at as lastentryat, items, rotation, " +
        "intervals, doses_done as dosesdone, heads_up_days as headsupdays, weekdays, dose, dose_set_at as dosesetat, opposite_of as oppositeof, paused, " +
        "cycle, cycle_pos as cyclepos, dose_options as doseoptions, full_dose as fulldose, " +
        "snoozed_until as snoozeduntil, created_at as createdat";

    public bool Daily => EveryDays == 1;
    /// <summary>Repeating gaps (twice a week: 4 then 3 days).</summary>
    public bool Cycles => !Daily && Cycle.Length > 0;
    /// <summary>The gap after the next normal dose.</summary>
    public int NextGap => Cycles ? Cycle[CyclePos % Cycle.Length] : EveryDays;
    /// <summary>Whether a logged dose is the full one ("0.8", "0.8 ml" and "0.80ml" all are).</summary>
    public bool IsFull(string? dose) => FullDose is { } f && Amount(dose) is { } a && Amount(f) is { } b && a == b;
    private static decimal? Amount(string? s) =>
        s is null ? null : System.Text.RegularExpressions.Regex.Match(s, @"\d+(\.\d+)?") is { Success: true } m
            && decimal.TryParse(m.Value, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : null;
    /// <summary>Daily, on these days of the week only (0 = Sunday).</summary>
    public bool OnDay(DateOnly d) => Weekdays.Length == 0 || Weekdays.Contains((int)d.DayOfWeek);
    /// <summary>A daily schedule with a list is ticked off item by item.</summary>
    public bool ByItem => Daily && ItemNames.Length > 0;
    /// <summary>
    /// The things to take, without section headings. A line starting "# " in
    /// <see cref="Items"/> is a heading ("# Medicines", "# Vitamins") that groups
    /// the lines after it on screen; it's never ticked or counted.
    /// </summary>
    public string[] ItemNames => Items.Where(i => !IsHeading(i)).ToArray();
    public static bool IsHeading(string item) => item.StartsWith('#');
    /// <summary>A course with a set number of doses.</summary>
    public bool Course => Intervals.Length > 0;
    public int CourseTotal => Intervals.Length + 1;
    public bool Finished => Course && DosesDone >= CourseTotal;
    /// <summary>The gap after the <paramref name="n"/>th dose, or null when a course is over.</summary>
    public int? GapAfter(int n) => !Course ? EveryDays : n >= 1 && n <= Intervals.Length ? Intervals[n - 1] : null;
}

/// <summary>The minutes of the local day [Start, End) whose said doses count for a schedule.</summary>
internal sealed record DoseWindow(int Start, int End, string Zone);

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
        return QuietAt(l.Hour * 60 + l.Minute);
    }

    /// <summary>Whether a minute of the day falls in quiet hours.</summary>
    public bool QuietAt(int m)
    {
        return QuietStartMinute > QuietEndMinute
            ? m >= QuietStartMinute || m < QuietEndMinute
            : m >= QuietStartMinute && m < QuietEndMinute;
    }

    public static TimeZoneInfo ZoneOr(string? id, TimeZoneInfo fallback) =>
        id is { Length: > 0 } && TimeZoneInfo.TryFindSystemTimeZoneById(id, out var z) ? z : fallback;
}
