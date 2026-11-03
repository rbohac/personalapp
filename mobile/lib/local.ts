import * as SQLite from "expo-sqlite";

/**
 * Bo's on-phone store (SQLite): the last answer to every read, so screens
 * open instantly and work offline; the outbox of changes waiting to reach the
 * server; and captures said with no connection, waiting to be read.
 *
 * Synchronous on purpose: a screen's first paint reads its snapshot before
 * anything renders, so there's never an empty frame.
 */
const db = SQLite.openDatabaseSync("bo.db");

db.execSync(`
  create table if not exists cache (key text primary key, json text not null, at integer not null);
  create table if not exists outbox (
    id text primary key,          -- also the Idempotency-Key the server dedupes on
    seq integer not null,
    method text not null,
    path text not null,           -- path and query, e.g. /entries
    body text,
    local_id text,                -- the temporary id a create was given on the phone
    tries integer not null default 0,
    error text,
    created_at integer not null
  );
  create table if not exists pending_captures (
    id text primary key,
    text text not null,
    source text not null,
    at integer not null,
    result text,                  -- the capture result once read, JSON
    error text
  );
`);

/** Entries older than this are dropped from the cache (owner: 90 days). */
const KEEP_MS = 90 * 24 * 3600e3;

// --- cache: the last answer to a read, keyed by path and query ---

export function cacheGet<T = unknown>(key: string): { value: T; at: number } | null {
  const row = db.getFirstSync<{ json: string; at: number }>("select json, at from cache where key = ?", key);
  if (!row) return null;
  try {
    return { value: JSON.parse(row.json) as T, at: row.at };
  } catch {
    return null;
  }
}

export function cachePut(key: string, value: unknown): void {
  db.runSync("insert or replace into cache (key, json, at) values (?, ?, ?)", key, JSON.stringify(value), Date.now());
}

/** Every cached read whose key starts with `prefix` (e.g. "/entries"), for patching after an offline change. */
export function cacheKeys(prefix: string): string[] {
  return db.getAllSync<{ key: string }>("select key from cache where key like ?", `${prefix}%`).map((r) => r.key);
}

/** A screen's last rendered state, to paint before the network answers. */
export function snapshot<T>(name: string): T | null {
  return cacheGet<T>(`snapshot:${name}`)?.value ?? null;
}

export function saveSnapshot(name: string, value: unknown): void {
  try {
    cachePut(`snapshot:${name}`, value);
  } catch {
    /* a full disk mustn't break a screen */
  }
}

export function pruneCache(): void {
  db.runSync("delete from cache where at < ?", Date.now() - KEEP_MS);
}

// --- outbox: changes made on the phone, sent in order ---

export type OutboxRow = {
  id: string; seq: number; method: string; path: string; body: string | null;
  local_id: string | null; tries: number; error: string | null; created_at: number;
};

export function outboxAdd(row: { id: string; method: string; path: string; body: string | null; localId: string | null }): void {
  const seq = (db.getFirstSync<{ n: number | null }>("select max(seq) as n from outbox")?.n ?? 0) + 1;
  db.runSync(
    "insert into outbox (id, seq, method, path, body, local_id, created_at) values (?, ?, ?, ?, ?, ?, ?)",
    row.id, seq, row.method, row.path, row.body, row.localId, Date.now(),
  );
}

export function outboxAll(): OutboxRow[] {
  return db.getAllSync<OutboxRow>("select * from outbox order by seq");
}

export function outboxDelete(id: string): void {
  db.runSync("delete from outbox where id = ?", id);
}

export function outboxFail(id: string, error: string): void {
  db.runSync("update outbox set tries = tries + 1, error = ? where id = ?", error, id);
}

/** A create got its real id: point every later change at it instead of the temporary one. */
export function outboxRename(localId: string, realId: string): void {
  for (const r of outboxAll()) {
    const path = r.path.split(localId).join(realId);
    const body = r.body?.split(localId).join(realId) ?? null;
    if (path !== r.path || body !== r.body) db.runSync("update outbox set path = ?, body = ? where id = ?", path, body, r.id);
  }
}

/** Drop changes to something that never reached the server (made and deleted offline). */
export function outboxDropFor(localId: string): void {
  for (const r of outboxAll()) if (r.local_id === localId || r.path.includes(localId)) outboxDelete(r.id);
}

// --- captures said offline, read when back online ---

export type PendingCapture = { id: string; text: string; source: string; at: number; result: string | null; error: string | null };

export function pendingAdd(id: string, text: string, source: string): void {
  db.runSync("insert into pending_captures (id, text, source, at) values (?, ?, ?, ?)", id, text, source, Date.now());
}

export function pendingAll(): PendingCapture[] {
  return db.getAllSync<PendingCapture>("select * from pending_captures order by at");
}

export function pendingSetResult(id: string, result: unknown): void {
  db.runSync("update pending_captures set result = ?, error = null where id = ?", JSON.stringify(result), id);
}

export function pendingDelete(id: string): void {
  db.runSync("delete from pending_captures where id = ?", id);
}
