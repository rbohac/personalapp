import { useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

import { useAuth } from "../../lib/auth";
import { API_URL } from "../../lib/config";
import { registerPush } from "../../lib/push";
import { ensureNotificationPermission } from "../../lib/reminders";
import { usePalette, type Palette } from "../../lib/theme";

export default function SettingsScreen() {
  const c = usePalette();
  const { state, signOut } = useAuth();
  const [pushNote, setPushNote] = useState<string | null>(null);
  const user = state.status === "signedIn" ? state.user : null;

  async function testReminder() {
    if (!(await ensureNotificationPermission())) {
      Alert.alert("Notifications are off", "Turn them on in Settings › Bo › Notifications.");
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: { title: "Bo test reminder", body: "Local reminders work on this phone.", sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
    });
    Alert.alert("Scheduled", "Lock your phone — it rings in 5 seconds.");
  }

  async function connectPush() {
    try {
      await registerPush();
      setPushNote("Registered. The server can ring this phone.");
    } catch (e) {
      setPushNote(e instanceof Error ? e.message : "Couldn't register.");
    }
  }

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body}>
      <Group c={c} title="Account">
        <Line c={c} label="Signed in as" value={user?.email ?? "—"} />
        <Button c={c} label="Sign out" danger onPress={() => void signOut()} />
      </Group>

      <Group c={c} title="Notifications">
        <Button c={c} label="Send a test reminder" onPress={() => void testReminder()} />
        <Button c={c} label="Register for server push" onPress={() => void connectPush()} />
        {pushNote ? <Text style={[s.note, { color: c.muted }]}>{pushNote}</Text> : null}
      </Group>

      <Group c={c} title="About">
        <Line c={c} label="Version" value={Constants.expoConfig?.version ?? "?"} />
        <Line c={c} label="API" value={API_URL} />
      </Group>
    </ScrollView>
  );
}

function Group({ c, title, children }: { c: Palette; title: string; children: ReactNode }) {
  return (
    <View style={s.group}>
      <Text style={[s.groupTitle, { color: c.muted }]}>{title.toUpperCase()}</Text>
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>{children}</View>
    </View>
  );
}

function Line({ c, label, value }: { c: Palette; label: string; value: string }) {
  return (
    <View style={[s.line, { borderBottomColor: c.line }]}>
      <Text style={{ color: c.ink, fontSize: 16 }}>{label}</Text>
      <Text style={{ color: c.muted, fontSize: 15, flexShrink: 1 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Button({ c, label, onPress, danger }: { c: Palette; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.line, { borderBottomColor: c.line }]}>
      <Text style={{ color: danger ? c.danger : c.accent, fontSize: 16, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, gap: 24 },
  group: { gap: 6 },
  groupTitle: { fontSize: 12, fontWeight: "600", paddingHorizontal: 4 },
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  note: { padding: 14, fontSize: 14 },
});
