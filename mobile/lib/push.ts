import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

import { api, must } from "./api";
import { EAS_PROJECT_ID } from "./config";

/**
 * Server push: register this install's Expo push token with the API so the
 * server can ring this phone later (nothing sends one yet — that arrives with
 * the first server-side feature that needs it). Local reminders don't use
 * this at all.
 */
const INSTALL_KEY = "bo.install-id";

async function installationId(): Promise<string> {
  const kept = await SecureStore.getItemAsync(INSTALL_KEY);
  if (kept) return kept;
  const id = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await SecureStore.setItemAsync(INSTALL_KEY, id);
  return id;
}

/** Throws in words for each thing that can stop it. */
export async function registerPush(): Promise<string> {
  if (!EAS_PROJECT_ID) throw new Error("No EAS project id in this build. Run `eas init` (docs/SETUP.md step 5) and rebuild.");
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) throw new Error("Notifications are off for Bo. Turn them on in Settings › Bo › Notifications.");

  const token = (await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })).data;
  must(await api.POST("/devices", { body: { installationId: await installationId(), expoToken: token, platform: Platform.OS } }));
  return token;
}

/** Best effort at launch: quietly keep the server's copy of the token fresh. */
export async function refreshPushRegistration(): Promise<void> {
  try {
    if ((await Notifications.getPermissionsAsync()).granted) await registerPush();
  } catch {
    /* offline, simulator, no project id yet — Settings shows the reason */
  }
}
