import { useSyncExternalStore } from "react";

import { API_URL } from "./config";
import { changed } from "./events";
import {
  cacheGet, cacheKeys, cachePut, outboxAdd, outboxAll, outboxDelete, outboxDropFor, outboxFail, outboxRename,
  pendingAll, pendingSetResult, pruneCache,
} from "./local";
import { getToken } from "./token";

/**
 * Offline, under the API client (it's the client's `fetch`), so no screen
 * has to know about it:
 *
 *  - A read that succeeds is saved; a read that can't reach the server is
 *    answered from the saved copy (header X-Bo-Offline: 1).
 *  - A change the app makes often — logging, ticking, Done, tasks — that
 *    can't reach the server goes into the outbox, is applied to the saved
 *    copies straight away (so screens show it), and is sent in order when the
 *    connection is back. Each change carries an Idempotency-Key, so a retry
 *    after a lost answer never applies twice.
 *  - Anything else (settings, editing a schedule, Ask) needs a connection and
 *    says so.
 */

const READ_TIMEOUT_MS = 8000;
const WRITE_TIMEOUT_MS = 12000;

export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

class Offline extends Error {}

/** A network failure (no signal, server unreachable, too slow), as opposed to an answer. */
export function isOffline(e: unknown): boolean {
  return e instanceof Offline || e instanceof TypeError || (e instanceof Error && /network|offline|timed out/i.test(e.message));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Offline("timed out")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const json = (value: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(value === null ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...extra } });

const keyOf = (url: string) => url.startsWith(API_URL) ? url.slice(API_URL.length) : url;

// --- which changes may wait for the connection ---

type Kind =
  | { t: "entry-create" } | { t: "entry-update"; id: string } | { t: "entry-delete"; id: string }
  | { t: "task-create" } | { t: "task-update"; id: string } | { t: "task-delete"; id: string } | { t: "task-done"; id: string; done: boolean }
  | { t: "schedule-done"; id: string } | { t: "schedule-items"; id: string } | { t: "schedule-snooze"; id: string };

function kindOf(method: string, path: string): Kind | null {
  const p = path.split("?")[0];
  let m: RegExpMatchArray | null;
  if (method === "POST" && p === "/entries") return { t: "entry-create" };
  if ((m = p.match(/^\/entries\/([^/]+)$/))) return method === "PUT" ? { t: "entry-update", id: m[1] } : method === "DELETE" ? { t: "entry-delete", id: m[1] } : null;
  if (method === "POST" && p === "/tasks") return { t: "task-create" };
  if ((m = p.match(/^\/tasks\/([^/]+)$/))) return method === "PUT" ? { t: "task-update", id: m[1] } : method === "DELETE" ? { t: "task-delete", id: m[1] } : null;
  if (method === "POST" && (m = p.match(/^\/tasks\/([^/]+)\/(complete|reopen)$/))) return { t: "task-done", id: m[1], done: m[2] === "complete" };
  if (method === "POST" && (m = p.match(/^\/schedules\/([^/]+)\/(done|items|snooze)$/)))
    return m[2] === "done" ? { t: "schedule-done", id: m[1] } : m[2] === "items" ? { t: "schedule-items", id: m[1] } : { t: "schedule-snooze", id: m[1] };
  return null;
}

/** The API client's fetch. */
export async function offlineFetch(request: Request): Promise<Response> {
  const path = keyOf(request.url);
  if (request.method === "GET") {
    try {
      const res = await withTimeout(fetch(request), READ_TIMEOUT_MS);
      if (res.status >= 500) {
        const saved = cacheGet(path);
        if (saved) return json(saved.value, 200, { "X-Bo-Offline": "1" });
      }
      if (res.ok) {
        const text = await res.clone().text();
        try { cachePut(path, JSON.parse(text)); } catch { /* not JSON: don't keep */ }
        setOnline(true);
      }
      return res;
    } catch (e) {
      const saved = cacheGet(path);
      setOnline(false);
      if (saved) return json(saved.value, 200, { "X-Bo-Offline": "1" });
      throw e;
    }
  }

  const kind = kindOf(request.method, path);
  if (!kind) {
    try {
      const res = await fetch(request);
      setOnline(true);
      return res;
    } catch (e) {
      setOnline(false);
      throw new Error("You're offline. This needs a connection.", { cause: e });
    }
  }

  const id = uuid();
  const body = request.method === "DELETE" ? null : await request.clone().text().catch(() => null);
  const headers = new Headers(request.headers);
  headers.set("Idempotency-Key", id);
  // Something queued goes first: changes reach the server in the order they were made.
  if (outboxAll().length === 0) {
    try {
      const res = await withTimeout(fetch(request.url, { method: request.method, headers, body: body ?? undefined }), WRITE_TIMEOUT_MS);
      setOnline(true);
      return res;
    } catch {
      setOnline(false);
    }
  }

  // Offline: queue it, and show it.
  const localId = kind.t === "entry-create" || kind.t === "task-create" ? `local-${uuid()}` : null;
  if (kind.t === "entry-delete" || kind.t === "task-delete") {
    if (kind.id.startsWith("local-")) {
      outboxDropFor(kind.id);
      apply(kind, null, null);
      notify();
      return new Response(null, { status: 204 });
    }
  }
  outboxAdd({ id, method: request.method, path, body, localId });
  const result = apply(kind, body ? safeParse(body) : null, localId);
  notify();
  scheduleFlush(state.online ? 0 : 5000);
  return kind.t.endsWith("delete") ? new Response(null, { status: 204 }) : json(result ?? {}, 200, { "X-Bo-Offline": "1" });
}

const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

// --- showing a queued change in the saved copies ---

type Rec = Record<string, unknown> & { id?: string };

/** Change every saved list (or item) under `prefix` with `fn`; returns what `pick` found. */
function patch(prefix: string, fn: (list: Rec[]) => Rec[]) {
  for (const key of cacheKeys(prefix)) {
    const saved = cacheGet<unknown>(key);
    if (!saved) continue;
    if (Array.isArray(saved.value)) cachePut(key, fn(saved.value as Rec[]));
    else if (saved.value && typeof saved.value === "object") {
      const out = fn([saved.value as Rec]);
      if (out[0]) cachePut(key, out[0]);
    }
  }
}

function findIn(prefix: string, id: string): Rec | null {
  for (const key of cacheKeys(prefix)) {
    const v = cacheGet<unknown>(key)?.value;
    const hit = Array.isArray(v) ? (v as Rec[]).find((x) => x?.id === id) : (v as Rec)?.id === id ? (v as Rec) : null;
    if (hit) return hit;
  }
  return null;
}

/** "{a}/{b} · pulse {c}" filled from the saved area, the way the server writes summaries. */
function summarize(areaId: string, data: Record<string, unknown>): string {
  const areas = cacheGet<Rec[]>("/areas")?.value ?? [];
  const area = areas.find((a) => a.id === areaId) as { name?: string; summary?: string; fields?: { key: string; type: string; trueLabel?: string; falseLabel?: string }[] } | undefined;
  if (!area?.summary) return area?.name ?? areaId;
  const parts = area.summary.split(" · ").flatMap((seg) => {
    let missing = false;
    const s = seg.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = data[k];
      const f = area.fields?.find((x) => x.key === k);
      if (v === undefined || v === null || v === "") { missing = true; return ""; }
      if (typeof v === "boolean") return v ? f?.trueLabel ?? "Yes" : f?.falseLabel ?? "No";
      return f?.type === "choice" ? String(v).replace(/-/g, " ") : String(v);
    });
    return missing ? [] : [s];
  });
  const text = parts.join(" · ") || area.name || areaId;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function apply(kind: Kind, body: Rec | null, localId: string | null): Rec | null {
  const now = new Date().toISOString();
  switch (kind.t) {
    case "entry-create": {
      const data = (body?.data as Record<string, unknown>) ?? {};
      const entry: Rec = {
        id: localId!, area: body?.area, at: (body?.at as string) ?? now, data, summary: summarize(String(body?.area), data),
        source: body?.source ?? "manual", raw: body?.raw ?? null, createdAt: now,
      };
      for (const key of cacheKeys("/entries?")) {
        const area = new URLSearchParams(key.split("?")[1]).get("area");
        if (area && area !== body?.area) continue;
        const v = cacheGet<Rec[]>(key)?.value;
        if (Array.isArray(v)) cachePut(key, [entry, ...v]);
      }
      return entry;
    }
    case "entry-update": {
      let out: Rec | null = null;
      patch("/entries", (l) => l.map((e) => (e.id === kind.id ? (out = { ...e, ...(body ?? {}), summary: summarize(String(e.area), (body?.data as Record<string, unknown>) ?? {}) }) : e)));
      return out;
    }
    case "entry-delete":
      patch("/entries", (l) => l.filter((e) => e.id !== kind.id));
      return null;
    case "task-create": {
      const task: Rec = { id: localId!, notes: null, list: "personal", dueAt: null, remindAt: null, doneAt: null, ...(body ?? {}), createdAt: now, updatedAt: now };
      for (const key of cacheKeys("/tasks?")) {
        const q = new URLSearchParams(key.split("?")[1]);
        if ((q.get("filter") ?? "open") !== "open" || (q.get("list") && q.get("list") !== task.list)) continue;
        const v = cacheGet<Rec[]>(key)?.value;
        if (Array.isArray(v)) cachePut(key, [task, ...v]);
      }
      return task;
    }
    case "task-update": {
      let out: Rec | null = null;
      patch("/tasks", (l) => l.map((t) => (t.id === kind.id ? (out = { ...t, ...(body ?? {}), updatedAt: now }) : t)));
      return out ?? findIn("/tasks", kind.id);
    }
    case "task-delete":
      patch("/tasks", (l) => l.filter((t) => t.id !== kind.id));
      return null;
    case "task-done": {
      let out: Rec | null = null;
      patch("/tasks", (l) => l.map((t) => (t.id === kind.id ? (out = { ...t, doneAt: kind.done ? now : null }) : t)));
      return out;
    }
    case "schedule-items":
    case "schedule-done":
    case "schedule-snooze": {
      let out: Rec | null = null;
      patch("/schedules", (l) => l.map((s) => (s.id === kind.id ? (out = scheduleAfter(s, kind, body)) : s)));
      return out;
    }
  }
}

type Mark = { item: string; state: string; remindAt: string | null; byEntry: boolean };

function scheduleAfter(s: Rec, kind: Kind, body: Rec | null): Rec {
  const today = ((s.today as Mark[]) ?? []).map((m) => ({ ...m }));
  const status = { ...(s.status as Rec) };
  if (kind.t === "schedule-snooze") {
    return { ...s, snoozedUntil: new Date(Date.now() + Number(body?.minutes ?? 60) * 60e3).toISOString() };
  }
  if (kind.t === "schedule-items") {
    const m = today.find((x) => x.item === body?.item);
    if (m) {
      m.state = String(body?.state);
      m.remindAt = (body?.remindAt as string) ?? null;
      m.byEntry = false;
    }
  } else {
    for (const m of today) if (m.state === "open" || m.state === "later") m.state = "taken";
    status.lastDoneAt = new Date().toISOString();
  }
  const open = today.filter((m) => m.state === "open").length;
  const taken = today.filter((m) => m.state === "taken").length;
  if (kind.t === "schedule-done" || (today.length > 0 && open === 0)) {
    status.state = "done";
    status.label = "Done · waiting to sync";
  } else if (today.length > 0) {
    status.label = `${taken} of ${today.length} taken`;
  }
  return { ...s, today, status, lastDoneAt: kind.t === "schedule-done" ? new Date().toISOString() : s.lastDoneAt };
}

// --- sending the outbox ---

let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), ms);
}

/**
 * Send queued changes in order, then read any captures said offline.
 * Stops at the first one that can't reach the server and tries again later.
 * A change the server refuses (a 4xx) is dropped and reported, so one bad
 * change can't hold up the rest.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  setState({ syncing: true });
  let sent = 0;
  try {
    for (const row of outboxAll()) {
      const token = getToken();
      if (!token) break;
      let res: Response;
      try {
        res = await withTimeout(
          fetch(API_URL + row.path, {
            method: row.method,
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": row.id },
            body: row.body ?? undefined,
          }),
          WRITE_TIMEOUT_MS,
        );
      } catch {
        setOnline(false);
        outboxFail(row.id, "offline");
        scheduleFlush(20000);
        return;
      }
      setOnline(true);
      if (res.status === 401) return;
      if (res.status >= 500 || res.status === 429 || res.status === 408) {
        outboxFail(row.id, `server ${res.status}`);
        scheduleFlush(30000);
        return;
      }
      if (res.ok && row.local_id) {
        const created = (await res.json().catch(() => null)) as Rec | null;
        if (created?.id) outboxRename(row.local_id, created.id);
      } else if (!res.ok) {
        const text = await res.text().catch(() => "");
        state.failed = [...state.failed, `${row.method} ${row.path.split("?")[0]}: ${readable(text) ?? res.status}`].slice(-5);
      }
      outboxDelete(row.id);
      sent++;
      notify();
    }
    await readPendingCaptures();
    pruneCache();
  } finally {
    flushing = false;
    setState({ syncing: false });
    notify();
    // What the server worked out from the changes (statuses, totals) replaces the guesses.
    if (sent > 0) {
      changed("entries");
      changed("tasks");
      changed("schedules");
    }
  }
}

function readable(text: string): string | null {
  try {
    const e = JSON.parse(text) as { title?: string; errors?: Record<string, string[]> };
    return (e.errors ? Object.values(e.errors).flat()[0] : undefined) ?? e.title ?? null;
  } catch {
    return null;
  }
}

/** Captures said with no connection: read them now; they wait on Home for review. */
async function readPendingCaptures() {
  const token = getToken();
  if (!token) return;
  for (const p of pendingAll().filter((x) => !x.result)) {
    try {
      const res = await withTimeout(
        fetch(`${API_URL}/capture`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: p.text, source: p.source, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        }),
        30000,
      );
      if (!res.ok) continue;
      pendingSetResult(p.id, await res.json());
      changed("entries");
    } catch {
      return;
    }
  }
}

// --- status, for the badge on Home ---

type SyncState = { online: boolean; pending: number; syncing: boolean; failed: string[]; toReview: number };
let state: SyncState = { online: true, pending: 0, syncing: false, failed: [], toReview: 0 };
const listeners = new Set<() => void>();

function setState(p: Partial<SyncState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

function setOnline(online: boolean) {
  if (state.online !== online) setState({ online });
}

/** Re-read the counts from the store. */
export function notify() {
  setState({ pending: outboxAll().length, toReview: pendingAll().filter((p) => p.result).length });
}

export function clearFailed() {
  setState({ failed: [] });
}

export function useSync(): SyncState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}
