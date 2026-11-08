import { cacheGet, cachePut } from "./local";

/**
 * The last requests Bo made, for Settings → Connection: what was asked, what
 * came back (or the error, in the system's own words), how long it took and
 * whether it was a retry. Kept in memory and saved now and then, so it
 * survives a restart.
 */
export type NetEvent = { at: number; method: string; path: string; status: number | null; error: string | null; ms: number; retry: boolean };

const KEY = "meta:netlog";
const MAX = 60;
let events: NetEvent[] = cacheGet<NetEvent[]>(KEY)?.value ?? [];
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function logNet(e: NetEvent) {
  events = [e, ...events].slice(0, MAX);
  if (!saveTimer) saveTimer = setTimeout(() => {
    saveTimer = null;
    try { cachePut(KEY, events); } catch { /* best effort */ }
  }, 3000);
}

export function netEvents(): NetEvent[] {
  return events;
}

export function clearNetLog() {
  events = [];
  try { cachePut(KEY, events); } catch { /* best effort */ }
}
