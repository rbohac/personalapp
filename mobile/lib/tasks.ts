import { api, must, type Task, type TaskInput } from "./api";
import { cancelReminder, syncReminder, syncReminders } from "./reminders";

/**
 * Task calls. Every write also brings the phone's local reminder in line with
 * what the API now holds, so the schedule follows the server's answer rather
 * than what the screen hoped it would be.
 */
export type TaskFilter = "open" | "done" | "all";

/** `list` narrows to one list. Reminders are re-synced only from the full open list, never a narrowed one. */
export async function listTasks(filter: TaskFilter = "open", list?: string): Promise<Task[]> {
  const tasks = must(await api.GET("/tasks", { params: { query: { filter, list } } }));
  if (filter === "open" && !list) await syncReminders(tasks).catch(() => undefined);
  return tasks;
}

export async function getTask(id: string): Promise<Task> {
  return must(await api.GET("/tasks/{id}", { params: { path: { id } } }));
}

export async function createTask(input: TaskInput): Promise<Task> {
  const task = must(await api.POST("/tasks", { body: input }));
  await syncReminder(task).catch(() => undefined);
  return task;
}

export async function updateTask(id: string, input: TaskInput): Promise<Task> {
  const task = must(await api.PUT("/tasks/{id}", { params: { path: { id } }, body: input }));
  await syncReminder(task).catch(() => undefined);
  return task;
}

/** The whole form as it stands, from a task — for edits that change one field. */
export function inputOf(t: Task): TaskInput {
  return { title: t.title, notes: t.notes, list: t.list, dueAt: t.dueAt, remindAt: t.remindAt };
}

export async function setDone(id: string, done: boolean): Promise<Task> {
  const r = done
    ? await api.POST("/tasks/{id}/complete", { params: { path: { id } } })
    : await api.POST("/tasks/{id}/reopen", { params: { path: { id } } });
  const task = must(r);
  await syncReminder(task).catch(() => undefined);
  return task;
}

export async function deleteTask(id: string): Promise<void> {
  must(await api.DELETE("/tasks/{id}", { params: { path: { id } } }));
  await cancelReminder(id);
}
