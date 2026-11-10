import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, Text, View } from "react-native";
import { router, Stack, type ErrorBoundaryProps } from "expo-router";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SignIn } from "../components/SignIn";
import { AuthProvider, useAuth } from "../lib/auth";
import { changed } from "../lib/events";
import { refreshPushRegistration } from "../lib/push";
import { ensureNotificationPermission, registerReminderCategory, reminderActionOf } from "../lib/reminders";
import { getTask, inputOf, setDone, updateTask } from "../lib/tasks";
import { usePalette } from "../lib/theme";
import { applyLatestUpdate } from "../lib/updates";
import { clearCache } from "../lib/local";
import { flush, wake, notify } from "../lib/offline";
import { markDone, registerScheduleCategory, reportTimeZone, scheduleActionOf, setItem, snooze } from "../lib/schedules";

/**
 * A screen that throws while drawing shows this instead of taking the whole
 * app down (expo-updates treats a crash at launch as a broken update). Try
 * again re-renders; Clear saved copies drops the phone's cached reads, in
 * case it's an old saved copy the new code can't read (2026-11-10).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const c = usePalette();
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 24, paddingTop: 80, gap: 14 }}>
      <Text style={{ color: c.ink, fontSize: 22, fontWeight: "700" }}>Something went wrong</Text>
      <Text style={{ color: c.muted, fontSize: 15 }}>Bo hit an error drawing this screen. Nothing you logged is lost.</Text>
      <Text style={{ color: c.danger, fontSize: 13 }} selectable>{error.message}</Text>
      <Pressable onPress={() => void retry()} style={{ backgroundColor: c.accent, borderRadius: 12, padding: 14, alignItems: "center" }}>
        <Text style={{ color: c.accentInk, fontSize: 16, fontWeight: "600" }}>Try again</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          try { clearCache(); } catch { /* nothing to clear */ }
          void retry();
        }}
        style={{ borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 14, alignItems: "center" }}
      >
        <Text style={{ color: c.ink, fontSize: 16 }}>Clear saved copies and try again</Text>
      </Pressable>
    </ScrollView>
  );
}

export default function RootLayout() {
  // New code arrives over the air; apply it on this launch instead of the next.
  useEffect(() => {
    void applyLatestUpdate();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Act on a tapped schedule push. Done (Took all / Took it) logs it; In 1 hour
 * snoozes (or re-times a put-off item); a plain tap opens Today — asking when
 * to be reminded about what's left, when the push was about that.
 */
async function followSchedule(a: NonNullable<ReturnType<typeof scheduleActionOf>>) {
  try {
    if (a.item) {
      if (a.action === "done") await setItem(a.scheduleId, a.item, "taken");
      else if (a.action === "later") await setItem(a.scheduleId, a.item, "later", new Date(Date.now() + 60 * 60 * 1000));
    } else if (a.action === "done") await markDone(a.scheduleId);
    else if (a.action === "later") await snooze(a.scheduleId, 60);
    router.navigate(a.action === "open" && a.ask ? { pathname: "/", params: { ask: a.scheduleId } } : "/");
  } catch (e) {
    Alert.alert("Not updated", e instanceof Error ? e.message : "The server didn't take it.");
  }
}

/** Act on a tapped reminder: Done, a snooze, or a plain tap that opens the task. */
async function follow(r: Notifications.NotificationResponse) {
  const sa = scheduleActionOf(r);
  if (sa) return followSchedule(sa);
  if ((r.notification.request.content.data as { kind?: unknown } | undefined)?.kind === "goals") return void router.navigate("/");
  const a = reminderActionOf(r);
  if (!a) return;
  try {
    if ("done" in a.action) {
      await setDone(a.taskId, true);
    } else if ("snooze" in a.action) {
      const task = await getTask(a.taskId);
      await updateTask(a.taskId, { ...inputOf(task), remindAt: a.action.snooze.toISOString() });
    } else {
      router.push({ pathname: "/task/[id]", params: { id: a.taskId } });
    }
    changed("tasks");
  } catch (e) {
    Alert.alert("Reminder not updated", e instanceof Error ? e.message : "The server didn't take it.");
  }
}

function Gate() {
  const c = usePalette();
  const { state } = useAuth();
  const signedIn = state.status === "signedIn";

  // Taps that arrive before sign-in (or before the screens exist) wait here,
  // and each response is followed once even if iOS delivers it twice.
  const queue = useRef<Notifications.NotificationResponse[]>([]);
  const taken = useRef(new Set<string>());

  useEffect(() => {
    void registerReminderCategory();
    void registerScheduleCategory();
    const take = (r: Notifications.NotificationResponse) => {
      const key = `${r.notification.request.identifier}:${r.notification.date}:${r.actionIdentifier}`;
      if (taken.current.has(key)) return;
      taken.current.add(key);
      queue.current.push(r);
      drain();
    };
    const sub = Notifications.addNotificationResponseReceivedListener(take);
    const last = Notifications.getLastNotificationResponse();
    if (last) take(last);
    return () => sub.remove();
  }, []);

  const signedInRef = useRef(false);
  signedInRef.current = signedIn;
  function drain() {
    if (!signedInRef.current) return;
    for (const r of queue.current.splice(0)) void follow(r);
  }

  // Send anything queued offline: at sign-in, and whenever Bo comes back to the front.
  useEffect(() => {
    if (!signedIn) return;
    notify();
    void flush();
    // Coming to the front: check the server now (a wake-up TLS blip doesn't stick), then send.
    const sub = AppState.addEventListener("change", (st) => st === "active" && void wake());
    return () => sub.remove();
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    drain();
    void reportTimeZone();
    void ensureNotificationPermission().then((ok) => {
      if (ok) void refreshPushRegistration();
    });
  }, [signedIn]);

  if (state.status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (!signedIn) return <SignIn />;

  return (
    <Stack screenOptions={{ headerTintColor: c.accent, headerStyle: { backgroundColor: c.bg }, headerTitleStyle: { color: c.ink }, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Home" }} />
      <Stack.Screen name="task/[id]" options={{ presentation: "modal", title: "Task" }} />
      <Stack.Screen name="area/[id]" options={{ title: "" }} />
      <Stack.Screen name="entry/[id]" options={{ presentation: "modal", title: "Entry" }} />
      <Stack.Screen name="ai-usage/index" options={{ title: "AI usage" }} />
      <Stack.Screen name="ai-usage/[id]" options={{ title: "Call" }} />
      <Stack.Screen name="vocabulary/index" options={{ title: "Words" }} />
      <Stack.Screen name="connection" options={{ title: "Connection" }} />
      <Stack.Screen name="checklist/[id]" options={{ title: "" }} />
      <Stack.Screen name="vocabulary/[id]" options={{ title: "Word" }} />
      <Stack.Screen name="schedule/[id]" options={{ title: "" }} />
      <Stack.Screen name="schedule/edit/[id]" options={{ presentation: "modal", title: "Edit schedule" }} />
      <Stack.Screen name="goal/[id]" options={{ presentation: "modal", title: "Goal" }} />
      <Stack.Screen name="capture" options={{ presentation: "modal", title: "Log" }} />
      <Stack.Screen name="ask" options={{ title: "Ask Bo" }} />
      <Stack.Screen name="trends" options={{ title: "Trends" }} />
    </Stack>
  );
}
