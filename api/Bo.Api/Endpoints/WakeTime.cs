using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Npgsql;

namespace Bo.Api.Endpoints;

/// <summary>
/// "Woke up" on a blood pressure reading: said as a clock time ("8:30a",
/// "08:30", "8 am") or relative to the reading ("30 min ago", "an hour ago",
/// "just now"). It's stored as HH:mm and written to that day's sleep log as
/// the waking time — the morning card and the sleep trends read it from there.
/// </summary>
public static partial class WakeTime
{
    /// <summary>The field on a blood pressure reading.</summary>
    public const string Field = "woke";

    /// <summary>HH:mm, or null when it can't be read. <paramref name="readingLocal"/> is the reading's local time.</summary>
    public static string? Parse(string? said, DateTime readingLocal)
    {
        var t = said?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(t)) return null;
        t = t.Replace("woke up", "").Replace("woke", "").Replace("up since", "").Replace("at ", "").Trim();

        if (t is "just now" or "now" or "just") return Hhmm(readingLocal);

        // Relative: "30 min ago", "1.5 hours ago", "an hour ago", "45m", "1h".
        if (Relative().Match(t) is { Success: true } r)
        {
            var n = r.Groups["n"].Value is "an" or "a" or "" ? 1m : decimal.Parse(r.Groups["n"].Value, CultureInfo.InvariantCulture);
            var minutes = r.Groups["u"].Value.StartsWith('h') ? n * 60 : n;
            if (minutes is < 0 or > 18 * 60) return null;
            return Hhmm(readingLocal.AddMinutes((double)-minutes));
        }

        // Clock: "8:30a", "8:30 am", "08:30", "0830", "8a", "8 am".
        if (Clock().Match(t) is { Success: true } c)
        {
            var h = int.Parse(c.Groups["h"].Value, CultureInfo.InvariantCulture);
            var m = c.Groups["m"].Success ? int.Parse(c.Groups["m"].Value, CultureInfo.InvariantCulture) : 0;
            var ap = c.Groups["ap"].Value;
            if (ap.StartsWith('p') && h < 12) h += 12;
            if (ap.StartsWith('a') && h == 12) h = 0;
            if (h > 23 || m > 59) return null;
            return $"{h:00}:{m:00}";
        }
        return null;
    }

    private static string Hhmm(DateTime t) => $"{t.Hour:00}:{t.Minute:00}";

    [GeneratedRegex(@"^(?<n>\d+(\.\d+)?|an|a)?\s*(?<u>h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b\s*(ago)?$")]
    private static partial Regex Relative();

    [GeneratedRegex(@"^(?<h>\d{1,2})(:?(?<m>\d{2}))?\s*(?<ap>a|am|a\.m\.|p|pm|p\.m\.)?$")]
    private static partial Regex Clock();

    /// <summary>
    /// Put the waking time on that day's sleep log: the newest sleep entry
    /// whose local day is the reading's, or a new one holding just the wake
    /// time (the morning card fills in the rest).
    /// </summary>
    public static async Task WriteToSleepAsync(NpgsqlConnection conn, Guid user, string zone, DateTime readingUtc, string hhmm)
    {
        var existing = await conn.ExecuteScalarAsync<Guid?>(
            """
            select id from entries
            where user_id = @user and area = 'sleep' and (at at time zone @zone)::date = (@at at time zone @zone)::date
            order by at desc limit 1
            """,
            new { user, zone, at = readingUtc });
        var patch = JsonSerializer.Serialize(new Dictionary<string, string> { ["wake"] = hhmm });
        if (existing is { } id)
            await conn.ExecuteAsync("update entries set data = data || @patch::jsonb, updated_at = now() where id = @id", new { id, patch });
        else
            await conn.ExecuteAsync(
                """
                insert into entries (user_id, area, at, data, source, raw)
                values (@user, 'sleep', ((@at at time zone @zone)::date + @wake::time) at time zone @zone, @patch::jsonb, 'manual', 'Woke up (from a blood pressure reading)')
                """,
                new { user, zone, at = readingUtc, wake = hhmm, patch });
    }
}
