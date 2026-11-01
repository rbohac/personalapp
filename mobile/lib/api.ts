import createClient, { type Middleware } from "openapi-fetch";

import type { components, paths } from "./api-schema";
import { API_URL } from "./config";

export type Task = components["schemas"]["TaskDto"];
export type TaskInput = components["schemas"]["TaskInput"];
export type User = components["schemas"]["UserDto"];
export type Session = components["schemas"]["SessionDto"];
export type Area = components["schemas"]["AreaDefinition"];
export type AreaField = components["schemas"]["AreaField"];
export type Entry = components["schemas"]["EntryDto"];
export type EntryInput = components["schemas"]["EntryInput"];
export type Proposal = components["schemas"]["Proposal"];
export type CaptureResult = components["schemas"]["CaptureResult"];

/**
 * The typed client. Every path, body and response type comes from the API's
 * OpenAPI contract (lib/api-schema.d.ts), so a renamed field on the server is
 * a type error here rather than an `undefined` at runtime.
 */
export const api = createClient<paths>({ baseUrl: API_URL });

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Set by the auth provider. A 401 on any call signs the app out. */
export function setAuth(t: string | null, signOut: (() => void) | null) {
  token = t;
  onUnauthorized = signOut;
}

// Both hooks change things in place and return nothing. openapi-fetch treats
// a returned value as a replacement and checks it with `instanceof Request` /
// `instanceof Response`, which React Native's fetch objects fail, so returning
// the same object threw on every call on the phone (never in Node).
const auth: Middleware = {
  onRequest({ request }) {
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
  },
  onResponse({ response }) {
    if (response.status === 401 && token) onUnauthorized?.();
  },
};
api.use(auth);

/**
 * Unwrap an openapi-fetch result: the data, or an Error whose message a person
 * can read — the API's validation message where it gave one.
 */
export function must<T>(r: { data?: T; error?: unknown; response: Response }): T {
  if (r.error === undefined && r.response.ok) return r.data as T;
  const e = r.error as { title?: string; detail?: string; errors?: Record<string, string[]> } | undefined;
  const first = e?.errors ? Object.values(e.errors).flat()[0] : undefined;
  throw new Error(first ?? e?.detail ?? e?.title ?? `The server answered ${r.response.status}.`);
}
