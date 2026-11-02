using System.Globalization;

namespace Bo.Api.Schedules;

/// <summary>
/// The rules, with no database: where a schedule stands, and how a logged
/// dose moves an every-N-days schedule. Kept pure so the reasoning is in one
/// place and reads top to bottom.
/// </summary>
internal static class ScheduleLogic
{
    /// <summary>
    /// A dose of an every-N-days schedule was logged on <paramref name="doseDay"/>.
    /// The next one is due N days after the dose actually happened (a late
    /// Tuesday shot makes the next one due Tuesday). Returns the new next-due
    /// day and, when the dose wasn't on the planned day, the planned day.
    /// </summary>
    public static (DateOnly Next, DateOnly? ShiftedFrom) AfterDose(ScheduleRow s, DateOnly doseDay)
    {
        var planned = Day(s.NextDue);
        var next = doseDay.AddDays(s.EveryDays);
        return (next, planned is { } p && p != doseDay ? p : null);
    }

    /// <summary>"Keep Mondays": go back to the planned rhythm, the first planned day after the dose.</summary>
    public static DateOnly KeepRhythm(ScheduleRow s, DateOnly lastDoseDay)
    {
        var day = Day(s.ShiftedFrom)!.Value;
        while (day <= lastDoseDay) day = day.AddDays(s.EveryDays);
        return day;
    }

    /// <param name="doneTodayAt">Daily only: today's matching entry, if any.</param>
    public static ScheduleStatus StatusOf(ScheduleRow s, Clock clock, DateTime utcNow, DateTime? doneTodayAt)
    {
        var today = clock.Today(utcNow);
        if (s.Paused) return new("paused", null, 0, "Paused");

        if (s.Daily)
        {
            var dueAt = clock.Utc(today, s.AtMinute);
            if (doneTodayAt is { } d) return new("done", dueAt, 0, $"Done at {Time(clock.Local(d))}");
            return utcNow < dueAt
                ? new("later", dueAt, 0, $"Due at {Time(clock.Local(dueAt))}")
                : new("due", dueAt, 0, "Due now");
        }

        if (Day(s.NextDue) is not { } next) return new("upcoming", null, 0, "No date set");
        var at = clock.Utc(next, s.AtMinute);
        if (next > today)
        {
            var days = next.DayNumber - today.DayNumber;
            var when = days == 1 ? "tomorrow" : days < 7 ? next.ToString("dddd", CultureInfo.InvariantCulture) : next.ToString("ddd MMM d", CultureInfo.InvariantCulture);
            return new("upcoming", at, 0, $"Next {when}");
        }
        if (next == today)
            return utcNow < at ? new("later", at, 0, $"Due today at {Time(clock.Local(at))}") : new("due", at, 0, "Due today");
        var late = today.DayNumber - next.DayNumber;
        return new("overdue", clock.Utc(today, s.AtMinute), late, late == 1 ? "1 day late" : $"{late} days late");
    }

    public static DateOnly? Day(string? iso) =>
        iso is { Length: > 0 } && DateOnly.TryParseExact(iso, "yyyy-MM-dd", out var d) ? d : null;

    public static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static string Hhmm(int minute) => $"{minute / 60:00}:{minute % 60:00}";

    public static int? Minute(string? hhmm) =>
        TimeOnly.TryParseExact(hhmm ?? "", "HH:mm", out var t) ? t.Hour * 60 + t.Minute : null;

    public static string Time(DateTime local) => local.ToString("h:mm tt", CultureInfo.InvariantCulture).ToLowerInvariant();

    public static string DayName(DateOnly d) => d.ToString("dddd", CultureInfo.InvariantCulture);

    /// <summary>The first <paramref name="weekday"/> on or after today, or a yyyy-MM-dd date.</summary>
    public static DateOnly StartDay(string? start, DateOnly today)
    {
        if (Day(start) is { } d) return d;
        if (Enum.TryParse<DayOfWeek>(start, ignoreCase: true, out var wd))
            return today.AddDays(((int)wd - (int)today.DayOfWeek + 7) % 7);
        return today;
    }
}
