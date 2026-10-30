import { api, must, type Area, type Entry, type EntryInput } from "./api";
import { changed } from "./events";

/**
 * Areas come from the API, which reads them from the repo's areas/ folder.
 * They change only when the API deploys, so one read per app launch is kept
 * here; `refreshAreas` forces another (pull to refresh on the Areas screen).
 */
let cached: Promise<Area[]> | null = null;

export function getAreas(): Promise<Area[]> {
  cached ??= api.GET("/areas").then(must).catch((e) => {
    cached = null; // a failed read is retried next time, not remembered
    throw e;
  });
  return cached;
}

export function refreshAreas(): Promise<Area[]> {
  cached = null;
  return getAreas();
}

export async function getArea(id: string): Promise<Area | undefined> {
  return (await getAreas()).find((a) => a.id === id);
}

/** The tasks area's lists ("personal", "home", "cranberry", ...). */
export async function taskLists(): Promise<{ id: string; label: string }[]> {
  return (await getAreas()).find((a) => a.kind === "tasks")?.lists ?? [{ id: "personal", label: "Personal" }];
}

export async function listEntries(area?: string, limit = 50): Promise<Entry[]> {
  return must(await api.GET("/entries", { params: { query: { area, limit } } }));
}

export async function latestEntries(): Promise<Entry[]> {
  return must(await api.GET("/entries/latest"));
}

export async function createEntry(input: EntryInput): Promise<Entry> {
  const e = must(await api.POST("/entries", { body: input }));
  changed("entries");
  return e;
}

export async function updateEntry(id: string, input: EntryInput): Promise<Entry> {
  const e = must(await api.PUT("/entries/{id}", { params: { path: { id } }, body: input }));
  changed("entries");
  return e;
}

export async function deleteEntry(id: string): Promise<void> {
  must(await api.DELETE("/entries/{id}", { params: { path: { id } } }));
  changed("entries");
}
