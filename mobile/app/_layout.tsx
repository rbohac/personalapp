import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { router, Stack } from "expo-router";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SignIn } from "../components/SignIn";
import { AuthProvider, useAuth } from "../lib/auth";
import { tasksChanged } from "../lib/events";
import { refreshPushRegistration } from "../lib/push";
import { ensureNotificationPermission, registerReminderCategory, reminderActionOf } from "../lib/reminders";
import { getTask, inputOf, setDone, updateTask } from "../lib/tasks";
import { usePalette } from "../lib/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/** Act on a tapped reminder: Done, a snooze, or a plain tap that opens the task. */
async function follow(r: Notifications.NotificationResponse) {
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
    tasksChanged();
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
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="task/[id]" options={{ presentation: "modal", title: "Task" }} />
    </Stack>
  );
}
