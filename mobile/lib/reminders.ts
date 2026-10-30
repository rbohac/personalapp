import * as Notifications from "expo-notifications";

import { presetTime, type ReminderPreset } from "./dates";
import type { Task } from "./api";

/**
 * Reminders ring from the PHONE: each task with a future `remindAt` becomes a
 * local scheduled notification, so a reminder works with no signal and no
 * server push. The API stores when; this file makes iOS ring then.
 *
 * Each task owns exactly one notification, identified `task-<id>`, so
 * rescheduling is "cancel that id, schedule again" and can never leave a
 * stale duplicate behind. `syncReminders` re-derives the whole set from the
 * task list on launch and on every refresh, which repairs anything a crash or
 * an edit on another device left out of step.
 */
export const REMINDER_CATEGORY = "bo.task";
const DONE = "bo.done";
const SNOOZE_PREFIX = "bo.snooze.";
const SNOOZES: { preset: ReminderPreset; title: string }[] = [
  { preset: "in_1h", title: "Snooze 1 hour" },
  { preset: "this_evening", title: "This evening" },
  { preset: "tomorrow_morning", title: "Tomorrow morning" },
];

const idFor = (taskId: string) => `task-${taskId}`;

// A reminder that rings while Bo is open still shows as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * The lock-screen buttons. They open the app to act, deliberately: acting
 * without opening needs a background task module and a new build, and opening
 * is the version that cannot lose a press. Swapping later is one option per
 * button.
 */
export async function registerReminderCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: DONE, buttonTitle: "Done", options: { opensAppToForeground: true } },
    ...SNOOZES.map((s) => ({ identifier: SNOOZE_PREFIX + s.preset, buttonTitle: s.title, options: { opensAppToForeground: true } })),
  ]);
}

/** Ask once. Reminders are the reason, so this is asked at first sign-in. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Make iOS's schedule match one task. Safe to call after any change. */
export async function syncReminder(task: Task): Promise<void> {
  const id = idFor(task.id);
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  if (task.doneAt || !task.remindAt) return;
  const at = new Date(task.remindAt);
  if (at.getTime() <= Date.now()) return;

  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: task.title,
      body: task.notes ?? undefined,
      sound: true,
      categoryIdentifier: REMINDER_CATEGORY,
      data: { kind: "task-reminder", taskId: task.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  });
}

export async function cancelReminder(taskId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(idFor(taskId)).catch(() => undefined);
}

/** Re-derive every task reminder from the open task list. */
export async function syncReminders(openTasks: Task[]): Promise<void> {
  const wanted = new Set(openTasks.filter((t) => t.remindAt).map((t) => idFor(t.id)));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith("task-") && !wanted.has(n.identifier))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  for (const t of openTasks) await syncReminder(t);
}

export type ReminderAction = { taskId: string; action: { done: true } | { snooze: Date } | { open: true } };

/** What a tap or a button on a reminder asks for, or null if it isn't one. */
export function reminderActionOf(r: Notifications.NotificationResponse): ReminderAction | null {
  const data = r.notification.request.content.data as { kind?: unknown; taskId?: unknown } | undefined;
  if (data?.kind !== "task-reminder" || typeof data.taskId !== "string") return null;
  const taskId = data.taskId;
  if (r.actionIdentifier === DONE) return { taskId, action: { done: true } };
  if (r.actionIdentifier.startsWith(SNOOZE_PREFIX)) {
    const preset = r.actionIdentifier.slice(SNOOZE_PREFIX.length) as ReminderPreset;
    if (SNOOZES.some((s) => s.preset === preset)) return { taskId, action: { snooze: presetTime(preset) } };
  }
  return { taskId, action: { open: true } };
}
