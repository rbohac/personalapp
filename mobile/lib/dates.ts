/**
 * Time helpers. Reminders are decided ON THE PHONE in the phone's own time
 * zone — "tomorrow morning" means your morning wherever you are — and sent to
 * the API as an instant (ISO with Z).
 */

export type ReminderPreset = "in_1h" | "in_3h" | "this_evening" | "tomorrow_morning";

export const PRESET_LABEL: Record<ReminderPreset, string> = {
  in_1h: "In 1 hour",
  in_3h: "In 3 hours",
  this_evening: "This evening",
  tomorrow_morning: "Tomorrow morning",
};

const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

export function presetTime(p: ReminderPreset, now = new Date()): Date {
  const d = new Date(now);
  switch (p) {
    case "in_1h":
      return new Date(now.getTime() + 60 * 60_000);
    case "in_3h":
      return new Date(now.getTime() + 3 * 60 * 60_000);
    case "this_evening":
      d.setHours(EVENING_HOUR, 0, 0, 0);
      // Already evening: an hour from now rather than a time in the past.
      return d.getTime() > now.getTime() + 15 * 60_000 ? d : new Date(now.getTime() + 60 * 60_000);
    case "tomorrow_morning":
      d.setDate(d.getDate() + 1);
      d.setHours(MORNING_HOUR, 0, 0, 0);
      return d;
  }
}

/** "Today 6:00 PM", "Tomorrow 9:00 AM", "Mon, Nov 3 9:00 AM". */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = startOfDay(d).getTime();
  const today = startOfDay(now).getTime();
  const oneDay = 24 * 60 * 60_000;
  if (day === today) return `Today ${time}`;
  if (day === today + oneDay) return `Tomorrow ${time}`;
  if (day === today - oneDay) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

export function isPast(iso: string | null | undefined, now = new Date()): boolean {
  return !!iso && new Date(iso).getTime() < now.getTime();
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
