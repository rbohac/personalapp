import { useSyncExternalStore } from "react";

import { API_URL } from "./config";
import { changed } from "./events";
import {
  cacheGet, cacheKeys, cachePut, outboxAdd, outboxAll, outboxDelete, outboxDropFor, outboxFail, outboxRename,
  pendingAll, pendingSetResult, pruneCache,
} from "./local";
import { logNet } from "./netlog";
import { rollGoals, rollSchedules } from "./rollover";
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
 *
 * Resilience, so a blip never sticks:
 *  - A request that fails at the network (a TLS error as the phone wakes, a
 *    dropped socket) is tried once more before anything is called offline.
 *  - Slow isn't offline: with a saved copy, a read that hasn't answered in a
 *    few seconds shows the copy and keeps going; when the answer lands, the
 *    screen refreshes.
 *  - Once offline, Bo checks the server on its own (2 s, 4 s, … up to a
 *    minute, and straight away when the app comes to the front). The moment
 *    it answers: queued changes are sent, offline captures read, and every
 *    screen reloads.
 *  - A saved copy from an earlier day is brought forward before it's shown
 *    (lib/rollover.ts), so yesterday's "Done" never reads as today's.
 */

/** With a saved copy to show meanwhile. */
const FAST_READ_MS = 4000;
/** With nothing saved, wait longer for the real answer. */
const READ_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 15000;
const RETRY_AFTER_MS = 700;

export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

class Offline extends Error {}
class TimedOut extends Offline {}

/** A network failure (no signal, server unreachable, too slow), as opposed to an answer. */
export function isOffline(e: unknown): boolean {
  return e instanceof Offline || e instanceof TypeError || (e instanceof Error && /network|offline|timed out/i.test(e.message));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimedOut("timed out")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** fetch, tried once more after a moment when it fails at the network (not when the server answers). Every try is logged. */
async function send(input: RequestInfo, init?: RequestInit): Promise<Response> {
  try {
    return await timed(input, init, false);
  } catch {
    await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
    return timed(input, init, true);
  }
}

async function timed(input: RequestInfo, init: RequestInit | undefined, retry: boolean): Promise<Response> {
  const started = Date.now();
  const url = input instanceof Request ? input.url : String(input);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const path = keyOf(url).split("?")[0];
  try {
    const res = await fetch(input instanceof Request ? input.clone() : input, init);
    logNet({ at: started, method, path, status: res.status, error: null, ms: Date.now() - started, retry });
    return res;
  } catch (e) {
    logNet({ at: started, method, path, status: null, error: errorText(e), ms: Date.now() - started, retry });
    throw e;
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Which screens to refresh when a slow read finally answers. */
function eventFor(path: string): Parameters<typeof changed>[0] | null {
  const p = path.split("?")[0];
  if (p.startsWith("/schedules")) return "schedules";
  if (p.startsWith("/entries")) return "entries";
  if (p.startsWith("/tasks")) return "tasks";
  if (p.startsWith("/goals")) return "goals";
  return null;
}

/** A saved read, as the screens get it: brought forward to today, marked as saved. */
function fromCache(path: string, saved: { value: unknown; at: number }): Response {
  const p = path.split("?")[0];
  const value = !Array.isArray(saved.value) ? saved.value
    : p === "/schedules" ? rollSchedules(saved.value, saved.at)
    : p === "/goals" ? rollGoals(saved.value, saved.at)
    : saved.value;
  return json(value, 200, { "X-Bo-Offline": "1" });
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
    const saved = cacheGet(path);
    const live = send(request).then(async (res) => {
      if (res.ok) {
        const text = await res.clone().text();
        try { cachePut(path, JSON.parse(text)); } catch { /* not JSON: don't keep */ }
        synced();
      }
      return res;
    });
    try {
      const res = await withTimeout(live, saved ? FAST_READ_MS : READ_TIMEOUT_MS);
      if (res.status >= 500 && saved) {
        wentOffline(`server ${res.status}`);
        return fromCache(path, saved);
      }
      return res;
    } catch (e) {
      if (e instanceof TimedOut && saved) {
        // Slow, not gone: show the copy now, and refresh when the answer lands.
        const ev = eventFor(path);
        live.then((r) => { if (r.ok && ev) changed(ev); }, (err) => wentOffline(errorText(err)));
        return fromCache(path, saved);
      }
      wentOffline(errorText(e));
      if (saved) return fromCache(path, saved);
      throw e;
    }
  }

  const kind = kindOf(request.method, path);
  if (!kind) {
    try {
      const res = await send(request);
      setOnline(true);
      return res;
    } catch (e) {
      wentOffline(errorText(e));
      throw new Error("Can't reach Bo right now. This needs a connection — try again in a moment.", { cause: e });
    }
  }

  const id = uuid();
  const body = request.method === "DELETE" ? null : await request.clone().text().catch(() => null);
  const headers = new Headers(request.headers);
  headers.set("Idempotency-Key", id);
  // Something queued goes first: changes reach the server in the order they were made.
  if (outboxAll().length === 0) {
    try {
      const res = await withTimeout(send(request.url, { method: request.method, headers, body: body ?? undefined }), WRITE_TIMEOUT_MS);
      setOnline(true);
      return res;
    } catch (e) {
      wentOffline(errorText(e));
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
          send(API_URL + row.path, {
            method: row.method,
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": row.id },
            body: row.body ?? undefined,
          }),
          WRITE_TIMEOUT_MS,
        );
      } catch (e) {
        outboxFail(row.id, "offline");
        wentOffline(errorText(e));
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
        send(`${API_URL}/capture`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: p.text, source: p.source, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        }),
        30000,
      );
      if (!res.ok) continue;
      pendingSetResult(p.id, await res.json());
      changed("entries");
    } catch (e) {
      wentOffline(errorText(e));
      return;
    }
  }
}

// --- status, for the badge on Home ---

/** Why Bo is offline: no internet at all, or the internet's fine and Bo's server isn't answering. */
export type OfflineReason = "network" | "server" | null;
type SyncState = {
  online: boolean; pending: number; syncing: boolean; failed: string[]; toReview: number;
  /** When a read last reached the server (ms). */
  lastSynced: number | null;
  reason: OfflineReason;
  /** The last network error, in the system's words (for the curious). */
  lastError: string | null;
};
let state: SyncState = {
  online: true, pending: 0, syncing: false, failed: [], toReview: 0,
  lastSynced: cacheGet<number>("meta:lastSynced")?.value ?? null, reason: null, lastError: null,
};
const listeners = new Set<() => void>();

function setState(p: Partial<SyncState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

let lastSyncWrite = 0;
function synced() {
  const now = Date.now();
  setOnline(true);
  if (now - lastSyncWrite > 30000) {
    lastSyncWrite = now;
    try { cachePut("meta:lastSynced", now); } catch { /* not worth failing a read over */ }
  }
  // Re-render Home at most every 30 s for this, not on every read.
  if (!state.lastSynced || now - state.lastSynced > 30000) setState({ lastSynced: now });
}

let lastReloadAll = 0;

function setOnline(online: boolean) {
  if (state.online === online) return;
  if (online) {
    // Back: stop checking, send what's waiting, and let every screen swap its saved copy for the real thing.
    stopProbe();
    setState({ online: true, reason: null, lastError: null });
    scheduleFlush(0);
    // Reload every screen once, not every time a flaky connection flips back.
    const now = Date.now();
    if (now - lastReloadAll > 20000) {
      lastReloadAll = now;
      changed("schedules");
      changed("entries");
      changed("tasks");
      changed("goals");
    }
  } else {
    setState({ online: false });
  }
}

function wentOffline(error: string) {
  setOnline(false);
  setState({ lastError: error });
  startProbe();
}

// --- checking for the way back, on its own ---

let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeDelay = 2000;

function startProbe() {
  if (probeTimer) return;
  probeTimer = setTimeout(() => void probe(), probeDelay);
}

function stopProbe() {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
  probeDelay = 2000;
}

async function reaches(url: string, ms: number): Promise<boolean> {
  try {
    const res = await withTimeout(timed(url, { cache: "no-store" }, false), ms);
    return res.ok;
  } catch {
    return false;
  }
}

async function probe() {
  probeTimer = null;
  if (await reaches(`${API_URL}/healthz`, 6000)) {
    setOnline(true);
    return;
  }
  // Tell "no internet" from "Bo's server isn't answering" — they're fixed in different places.
  const internet = await reaches("https://captive.apple.com/hotspot-detect.html", 5000);
  setState({ reason: internet ? "server" : "network" });
  probeDelay = Math.min(probeDelay * 2, 60000);
  startProbe();
}

/** For Settings → Connection: time one request (no retry, no caching). */
export async function check(url: string, auth: boolean, ms = 10000): Promise<{ ok: boolean; detail: string; ms: number }> {
  const started = Date.now();
  try {
    const token = auth ? getToken() : null;
    const res = await withTimeout(timed(url, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} }, false), ms);
    return { ok: res.ok, detail: `HTTP ${res.status}`, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, detail: errorText(e), ms: Date.now() - started };
  }
}

/** Drop one queued change that the server will never take, so the rest can go. */
export function discardQueued(id: string) {
  outboxDelete(id);
  notify();
  scheduleFlush(0);
}

/**
 * The app came to the front (or the strip was tapped): check now rather than
 * waiting for the next try, then send what's queued.
 */
export async function wake(): Promise<void> {
  if (!state.online) {
    stopProbe();
    await probe();
  }
  await flush();
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
