/**
 * A saved copy of the schedules from an earlier day, brought forward to
 * today. The server works out "done today" and "due now"; a copy saved
 * yesterday still says yesterday's answer ("Done at 1:00 pm", "8 of 8
 * taken"), which offline reads as today's. So before a saved copy is shown,
 * anything daily starts the day over: every item open, due at its time.
 * When the server answers, its answer replaces this guess.
 */

type Mark = { item: string; state: string; remindAt: string | null; byEntry: boolean };
type Status = { state: string; dueAt: string | null; daysLate: number | string; label: string };
type Sched = {
  everyDays: number | string; at: string; nextDue: string | null; paused: boolean;
  weekdays?: (number | string)[] | null; today?: Mark[]; status: Status;
};

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const timeLabel = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase();

/** Whether this saved copy needs bringing forward. */
export function isStale(savedAt: number, now = new Date()): boolean {
  return !sameDay(new Date(savedAt), now);
}

export function rollSchedules<T>(list: T[], savedAt: number, now = new Date()): T[] {
  if (!isStale(savedAt, now)) return list;
  return list.map((x) => rollOne(x as unknown as Sched, now) as unknown as T);
}

function rollOne(s: Sched, now: Date): Sched {
  if (s.paused || !s.status || ["paused", "finished"].includes(s.status.state)) return s;
  const [h, m] = (s.at ?? "08:00").split(":").map(Number);
  const dueAt = new Date(now);
  dueAt.setHours(h || 0, m || 0, 0, 0);

  if (Number(s.everyDays) === 1) {
    const days = (s.weekdays ?? []).map(Number);
    if (days.length > 0 && !days.includes(now.getDay())) {
      return { ...s, today: [], status: { ...s.status, state: "upcoming", label: "Off today", daysLate: 0 } };
    }
    const today = (s.today ?? []).map((t) => ({ ...t, state: "open", remindAt: null, byEntry: false }));
    const late = now >= dueAt;
    const label = today.length > 0
      ? (late ? `0 of ${today.length} taken` : `Due at ${timeLabel(dueAt)}`)
      : late ? "Due now" : `Due at ${timeLabel(dueAt)}`;
    return { ...s, today, status: { state: late ? "due" : "later", dueAt: dueAt.toISOString(), daysLate: 0, label } };
  }

  // Every N days: a due date that has now arrived reads as due.
  if (s.nextDue && s.nextDue <= localIso(now) && s.status.state === "upcoming") {
    const isToday = s.nextDue === localIso(now);
    return {
      ...s,
      status: { ...s.status, state: isToday ? (now >= dueAt ? "due" : "later") : "overdue", dueAt: dueAt.toISOString(), label: isToday ? "Due today" : "Late" },
    };
  }
  return s;
}

type GoalLike = { period: string; paused: boolean; progress: { value: number | string; met: boolean; label: string } };

/** Daily goals (protein, Brock Road) start the day at zero; weekly ones keep their week. */
export function rollGoals<T>(list: T[], savedAt: number, now = new Date()): T[] {
  if (!isStale(savedAt, now)) return list;
  return list.map((x) => {
    const g = x as unknown as GoalLike;
    if (g.period !== "day" || g.paused || !g.progress) return x;
    return { ...g, progress: { ...g.progress, value: 0, met: false, label: "Nothing yet today" } } as unknown as T;
  });
}
