import { api, must, type AiCall, type AiCallDetail, type UsageSummary } from "./api";

/**
 * AI usage and cost. Days and weeks are cut in the phone's time zone, so
 * "today" is your today. The API sends numbers as number-or-string (it
 * accepts both), so everything goes through num().
 */
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const num = (v: number | string | null | undefined): number => (v == null ? 0 : typeof v === "number" ? v : Number(v));

export async function usageSummary(): Promise<UsageSummary> {
  return must(await api.GET("/ai/usage/summary", { params: { query: { tz: tz(), days: 30, weeks: 12 } } }));
}

/** `day` is yyyy-MM-dd in the phone's time zone; omit it for the most recent calls. */
export async function usageCalls(day?: string): Promise<AiCall[]> {
  return must(await api.GET("/ai/usage/calls", { params: { query: { tz: tz(), day, limit: 50 } } }));
}

export async function usageCall(id: string): Promise<AiCallDetail> {
  return must(await api.GET("/ai/usage/calls/{id}", { params: { path: { id } } }));
}

/** Dollars at a precision that shows something: Haiku captures cost hundredths of a cent. */
export function money(v: number | string | null | undefined): string {
  if (v == null) return "unknown";
  const n = num(v);
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function tokens(v: number | string): string {
  return num(v).toLocaleString();
}

/** What happened on a call, in words, and whether it's a problem worth flagging. */
export const OUTCOME: Record<string, { label: string; problem: boolean }> = {
  ok: { label: "Read by the model", problem: false },
  refused: { label: "Model declined", problem: true },
  out_of_room: { label: "Model ran out of room", problem: true },
  error: { label: "Model error", problem: true },
  not_configured: { label: "No model key", problem: true },
  over_budget: { label: "Over budget", problem: true },
};

/** "Mon, Nov 3" from a yyyy-MM-dd that is already a local date (no time-zone shift). */
export function dayLabel(isoDate: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
