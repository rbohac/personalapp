import * as Updates from "expo-updates";

export type UpdateCheck =
  | { kind: "off" } // dev build or updates disabled
  | { kind: "current" }
  | { kind: "applying" }
  | { kind: "failed"; message: string };

/**
 * Check for a newer over-the-air update and, if there is one, download it
 * and restart straight into it. One open is enough to get new code, rather
 * than the default "download now, apply on the next launch".
 */
export async function applyLatestUpdate(): Promise<UpdateCheck> {
  if (__DEV__ || !Updates.isEnabled) return { kind: "off" };
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return { kind: "current" };
    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew) return { kind: "current" };
    await Updates.reloadAsync(); // restarts the JS; nothing after this runs
    return { kind: "applying" };
  } catch (e) {
    return { kind: "failed", message: e instanceof Error ? e.message : "Couldn't reach the update server." };
  }
}

/** What's running, in words: the built-in code, or which update and when it was published. */
export function runningLabel(): string {
  if (__DEV__) return "Development";
  if (!Updates.isEnabled) return "Updates off";
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return "Built-in (no update yet)";
  const when = Updates.createdAt
    ? Updates.createdAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  return `Update ${Updates.updateId.slice(0, 8)}${when ? ` · ${when}` : ""}`;
}

export function runtimeLabel(): string {
  return Updates.runtimeVersion ? Updates.runtimeVersion.slice(0, 12) : "—";
}
