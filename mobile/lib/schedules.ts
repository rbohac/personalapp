import * as Notifications from "expo-notifications";

import { api, must, type Schedule, type ScheduleInput } from "./api";
import { changed } from "./events";

/**
 * Schedules: what to take and when (morning meds daily, a shot every 7
 * days). The server decides what's due and sends the nudges; a schedule is
 * done when a matching entry is logged — by voice, typed, or Done here,
 * which logs one. Every edit reports "schedules" (and "entries" for a Done)
 * so lists on screen refetch.
 */
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function listSchedules(): Promise<Schedule[]> {
  return must(await api.GET("/schedules", { params: { query: { tz: tz() } } }));
}

/** Tell the server this phone's zone, so 8am nudges come at 8am here. Best effort. */
export async function reportTimeZone(): Promise<void> {
  try {
    must(await api.PUT("/me/time-zone", { body: { timeZone: tz() } }));
  } catch {
    /* offline; the next schedules read sends it too */
  }
}

function edited(entries = false) {
  changed("schedules");
  if (entries) changed("entries");
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule> {
  const s = must(await api.POST("/schedules", { body: input }));
  edited();
  return s;
}

export async function updateSchedule(id: string, input: ScheduleInput): Promise<Schedule> {
  const s = must(await api.PUT("/schedules/{id}", { params: { path: { id } }, body: input }));
  edited();
  return s;
}

export async function deleteSchedule(id: string): Promise<void> {
  must(await api.DELETE("/schedules/{id}", { params: { path: { id } } }));
  edited();
}

export async function markDone(id: string): Promise<Schedule> {
  const s = must(await api.POST("/schedules/{id}/done", { params: { path: { id } } }));
  edited(true);
  return s;
}

export async function snooze(id: string, minutes = 60): Promise<Schedule> {
  const s = must(await api.POST("/schedules/{id}/snooze", { params: { path: { id } }, body: { minutes } }));
  edited();
  return s;
}

export type ItemState = "taken" | "open" | "skipped" | "later";

/** Tick one item of a daily list. "later" needs the time to be reminded. */
export async function setItem(id: string, item: string, state: ItemState, remindAt?: Date): Promise<Schedule> {
  const s = must(
    await api.POST("/schedules/{id}/items", {
      params: { path: { id } },
      body: { item, state, remindAt: remindAt?.toISOString() ?? null },
    }),
  );
  edited(true);
  return s;
}

/** An item as a medication name: the text before any "(note)". Matches the server. */
export function itemName(item: string): string {
  const i = item.indexOf("(");
  return (i > 0 ? item.slice(0, i) : item).trim() || item.trim();
}

/** A dose moved the cadence: go back to the planned day. */
export async function keepDay(id: string): Promise<Schedule> {
  const s = must(await api.POST("/schedules/{id}/keep-day", { params: { path: { id } } }));
  edited();
  return s;
}

/** A dose moved the cadence and that's fine. */
export async function acceptDay(id: string): Promise<Schedule> {
  const s = must(await api.POST("/schedules/{id}/accept-day", { params: { path: { id } } }));
  edited();
  return s;
}

export function inputOf(s: Schedule): ScheduleInput {
  return {
    title: s.title, area: s.area, everyDays: Number(s.everyDays), at: s.at,
    match: s.match, nextDue: s.nextDue, items: s.items, paused: s.paused,
  };
}

/** yyyy-MM-dd as a weekday name: "Monday". */
export function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long" });
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "08:00" → "8:00 AM" in the phone's style. */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function cadenceLabel(s: Pick<Schedule, "everyDays" | "at">): string {
  const n = Number(s.everyDays);
  const every = n === 1 ? "Daily" : n === 7 ? "Weekly" : `Every ${n} days`;
  return `${every} · ${timeLabel(s.at)}`;
}

// Lock-screen buttons on schedule pushes. The server picks the category:
// bo.schedule (Done), bo.schedule.list (Took all, for a daily list), bo.item
// (one put-off item). They open the app to act, like the task reminders.
const DONE = "bo.schedule.done";
const LATER = "bo.schedule.later";

export async function registerScheduleCategory(): Promise<void> {
  const later = { identifier: LATER, buttonTitle: "In 1 hour", options: { opensAppToForeground: true } };
  await Notifications.setNotificationCategoryAsync("bo.schedule", [
    { identifier: DONE, buttonTitle: "Done", options: { opensAppToForeground: true } }, later,
  ]);
  await Notifications.setNotificationCategoryAsync("bo.schedule.list", [
    { identifier: DONE, buttonTitle: "Took all", options: { opensAppToForeground: true } }, later,
  ]);
  await Notifications.setNotificationCategoryAsync("bo.item", [
    { identifier: DONE, buttonTitle: "Took it", options: { opensAppToForeground: true } }, later,
  ]);
}

/**
 * What a tap or a button on a schedule push asks for, or null if it isn't
 * one. `item` is set for a put-off item's reminder; `ask` means "open Today
 * and ask when to be reminded about what's left".
 */
export type ScheduleAction = { scheduleId: string; item?: string; ask?: boolean; action: "done" | "later" | "open" };

export function scheduleActionOf(r: Notifications.NotificationResponse): ScheduleAction | null {
  const data = r.notification.request.content.data as { kind?: unknown; scheduleId?: unknown; item?: unknown; ask?: unknown } | undefined;
  const kind = data?.kind;
  if ((kind !== "schedule" && kind !== "schedule-shift" && kind !== "schedule-item") || typeof data?.scheduleId !== "string") return null;
  const action = r.actionIdentifier === DONE ? "done" : r.actionIdentifier === LATER ? "later" : "open";
  return {
    scheduleId: data.scheduleId,
    item: kind === "schedule-item" && typeof data.item === "string" ? data.item : undefined,
    ask: data.ask === true,
    action,
  };
}
