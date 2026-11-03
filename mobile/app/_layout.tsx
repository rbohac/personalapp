import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { router, Stack } from "expo-router";
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
import { markDone, registerScheduleCategory, reportTimeZone, scheduleActionOf, setItem, snooze } from "../lib/schedules";

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
