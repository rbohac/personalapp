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
    /// <param name="dosesDone">Doses counted including this one (courses use it to pick the gap).</param>
    public static (DateOnly? Next, DateOnly? ShiftedFrom) AfterDose(ScheduleRow s, DateOnly doseDay, int dosesDone)
    {
        var planned = Day(s.NextDue);
        if (s.GapAfter(dosesDone) is not { } gap) return (null, null); // the course is over
        return (doseDay.AddDays(gap), planned is { } p && p != doseDay ? p : null);
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

        if (s.Daily && !s.OnDay(today))
        {
            var on = today.AddDays(1);
            while (!s.OnDay(on)) on = on.AddDays(1);
            return new("upcoming", clock.Utc(on, s.AtMinute), 0, $"Off today · next {(on.DayNumber - today.DayNumber == 1 ? "tomorrow" : DayName(on))}");
        }

        if (s.Daily)
        {
            var dueAt = clock.Utc(today, s.AtMinute);
            if (doneTodayAt is { } d) return new("done", dueAt, 0, $"Done at {Time(clock.Local(d))}");
            return utcNow < dueAt
                ? new("later", dueAt, 0, $"Due at {Time(clock.Local(dueAt))}")
                : new("due", dueAt, 0, "Due now");
        }

        if (s.Finished) return new("finished", null, 0, $"Finished · all {s.CourseTotal}");
        if (Day(s.NextDue) is not { } next) return new("upcoming", null, 0, "Log the last one to start");
        var course = s.Course ? $" · {s.DosesDone} of {s.CourseTotal} done" : "";
        var at = clock.Utc(next, s.AtMinute);
        if (next > today)
        {
            var days = next.DayNumber - today.DayNumber;
            var when = days == 1 ? "tomorrow" : days < 7 ? next.ToString("dddd", CultureInfo.InvariantCulture) : next.ToString("ddd MMM d", CultureInfo.InvariantCulture);
            return new("upcoming", at, 0, $"Next {when}{course}");
        }
        if (next == today)
            return utcNow < at ? new("later", at, 0, $"Due today at {Time(clock.Local(at))}{course}") : new("due", at, 0, $"Due today{course}");
        var late = today.DayNumber - next.DayNumber;
        return new("overdue", clock.Utc(today, s.AtMinute), late, late == 1 ? "1 day late" : $"{late} days late");
    }

    /// <summary>
    /// A daily list, ticked item by item. It's done when nothing is left
    /// open: every item taken, skipped, or put off to a reminder.
    /// </summary>
    public static ScheduleStatus StatusOfList(ScheduleRow s, Clock clock, DateTime utcNow, IReadOnlyList<ItemMark> marks)
    {
        if (s.Paused) return new("paused", null, 0, "Paused");
        var dueAt = clock.Utc(clock.Today(utcNow), s.AtMinute);
        var open = marks.Count(m => m.State == "open");
        var taken = marks.Count(m => m.State == "taken");
        if (open == 0)
        {
            var later = marks.Where(m => m.State == "later" && m.RemindAt is not null).OrderBy(m => m.RemindAt).FirstOrDefault();
            var skipped = marks.Count(m => m.State == "skipped");
            var label = later is not null ? $"{Name(later.Item)} at {Time(clock.Local(later.RemindAt!.Value))}"
                : skipped > 0 ? $"Done · {skipped} skipped"
                : "All taken";
            return new("done", dueAt, 0, label);
        }
        var progress = taken > 0 ? $"{taken} of {marks.Count} · " : "";
        return utcNow < dueAt
            ? new("later", dueAt, 0, $"{progress}Due at {Time(clock.Local(dueAt))}")
            : new("due", dueAt, 0, taken > 0 ? $"{taken} of {marks.Count} taken" : "Due now");
    }

    /// <summary>An item as a medication name: the text before any "(note)".</summary>
    public static string Name(string item)
    {
        var i = item.IndexOf('(');
        var name = (i > 0 ? item[..i] : item).Trim();
        return name.Length > 0 ? name : item.Trim();
    }

    /// <summary>Does a logged medication name this item? Either contains the other, ignoring case.</summary>
    public static bool Names(string? medication, string item)
    {
        if (string.IsNullOrWhiteSpace(medication)) return false;
        var a = medication.Trim().ToLowerInvariant();
        var b = Name(item).ToLowerInvariant();
        return b.Length >= 3 && a.Length >= 3 && (a.Contains(b) || b.Contains(a));
    }

    public static DateOnly? Day(string? iso) =>
        iso is { Length: > 0 } && DateOnly.TryParseExact(iso, "yyyy-MM-dd", out var d) ? d : null;

    public static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static string Hhmm(int minute) => $"{minute / 60:00}:{minute % 60:00}";

    public static int? Minute(string? hhmm) =>
        TimeOnly.TryParseExact(hhmm ?? "", "HH:mm", out var t) ? t.Hour * 60 + t.Minute : null;

    public static string Time(DateTime local) => local.ToString("h:mm tt", CultureInfo.InvariantCulture).ToLowerInvariant();

    /// <summary>"left-abdomen" → "left"; null when a site has no side.</summary>
    public static string? Side(string? site) =>
        site?.StartsWith("left") == true ? "left" : site?.StartsWith("right") == true ? "right" : null;

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
