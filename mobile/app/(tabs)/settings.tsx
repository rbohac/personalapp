import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import * as Notifications from "expo-notifications";

import { useAuth } from "../../lib/auth";
import { API_URL } from "../../lib/config";
import { OUTCOME_LABEL, pushHealth, pushStatus, registerPush, testServerPush, type PushStatus } from "../../lib/push";
import { ensureNotificationPermission } from "../../lib/reminders";
import { applyLatestUpdate, runningLabel, runtimeLabel } from "../../lib/updates";
import { getRecognizerMode, getVocabulary, setRecognizerMode, type RecognizerMode } from "../../lib/vocabulary";
import { usePalette, type Palette } from "../../lib/theme";

export default function SettingsScreen() {
  const c = usePalette();
  const { state, signOut } = useAuth();
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const loadStatus = useCallback(() => {
    pushStatus().then(setStatus, () => setStatus(null));
  }, []);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [mode, setMode] = useState<RecognizerMode>("phone");
  const [wordCount, setWordCount] = useState<number | null>(null);

  useEffect(() => {
    void getRecognizerMode().then(setMode);
  }, []);
  useFocusEffect(useCallback(() => loadStatus(), [loadStatus]));
  useFocusEffect(
    useCallback(() => {
      getVocabulary().then((v) => setWordCount(v.length), () => setWordCount(null));
    }, []),
  );

  function changeMode(onPhone: boolean) {
    const m: RecognizerMode = onPhone ? "phone" : "apple";
    setMode(m);
    void setRecognizerMode(m);
  }
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

  /** Register this phone, then have the server push to it 5 seconds later. */
  async function setUpAndTest() {
    setTesting(true);
    try {
      await registerPush();
    } catch (e) {
      setPushNote(e instanceof Error ? e.message : "Couldn't register.");
      setTesting(false);
      loadStatus();
      return;
    }
    setPushNote("Registered. Lock your phone — a push from the server arrives in about 5 seconds.");
    try {
      const r = await testServerPush(5);
      setPushNote(
        r.outcome === "delivered" ? "Delivered — it should be on your lock screen now."
        : `${OUTCOME_LABEL[r.outcome] ?? r.outcome}${r.detail ? `: ${r.detail}` : "."}`,
      );
    } catch (e) {
      setPushNote(e instanceof Error ? e.message : "Couldn't reach the server.");
    } finally {
      setTesting(false);
      loadStatus();
    }
  }

  async function checkUpdates() {
    setUpdateNote("Checking…");
    const r = await applyLatestUpdate();
    setUpdateNote(
      r.kind === "current" ? "You're on the latest version."
      : r.kind === "applying" ? "Restarting into the new version…"
      : r.kind === "off" ? "Updates are off in this build."
      : r.message,
    );
  }

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body}>
      <Group c={c} title="Account">
        <Line c={c} label="Signed in as" value={user?.email ?? "—"} />
        <Button c={c} label="Sign out" danger onPress={() => void signOut()} />
      </Group>

      <Group c={c} title="Notifications">
        <Line
          c={c}
          label="Server push"
          value={status ? pushHealth(status).text : "Checking…"}
          tone={status ? (pushHealth(status).ok === true ? "good" : pushHealth(status).ok === false ? "bad" : undefined) : undefined}
        />
        <Button c={c} label={testing ? "Testing…" : "Set up & test server push"} onPress={() => !testing && void setUpAndTest()} />
        {pushNote ? <Text style={[s.note, { color: c.muted }]}>{pushNote}</Text> : null}
        <Button c={c} label="Send a test reminder (this phone only)" onPress={() => void testReminder()} />
        {status ? (
          <>
            <Line c={c} label="Server time zone" value={status.timeZone ?? "Not set yet"} />
            <Line
              c={c}
              label="Phones registered"
              value={status.devices.length === 0 ? "None" : `${status.devices.length}${status.devices.some((d) => d.thisPhone) ? " (incl. this one)" : " (not this one)"}`}
            />
            <Text style={[s.note, { color: c.muted, paddingBottom: 4 }]}>RECENT PUSHES</Text>
            {status.recent.length === 0 ? (
              <Text style={[s.note, { color: c.muted, paddingTop: 0 }]}>None yet.</Text>
            ) : (
              status.recent.slice(0, 6).map((p, i) => (
                <View key={i} style={[s.push, { borderBottomColor: c.line }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Text style={{ color: c.ink, fontSize: 14, flexShrink: 1 }} numberOfLines={1}>{p.title}</Text>
                    <Text style={{ color: p.outcome === "failed" || p.outcome === "no-devices" ? c.danger : c.muted, fontSize: 13 }}>
                      {OUTCOME_LABEL[p.outcome] ?? p.outcome}
                    </Text>
                  </View>
                  <Text style={{ color: c.muted, fontSize: 12 }}>
                    {new Date(p.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    {p.detail ? ` · ${p.detail}` : ""}
                  </Text>
                </View>
              ))
            )}
          </>
        ) : null}
      </Group>

      <Group c={c} title="Voice">
        <View style={[s.line, { borderBottomColor: c.line, alignItems: "center" }]}>
          <Text style={{ color: c.ink, fontSize: 16 }}>Recognize on this phone</Text>
          <Switch value={mode === "phone"} onValueChange={changeMode} />
        </View>
        <Text style={[s.note, { color: c.muted }]}>
          {mode === "phone" ? "Works offline. Audio stays on the phone." : "Uses Apple's servers. May pick up the words below more reliably."}
        </Text>
        <Pressable onPress={() => router.push("/vocabulary")} style={[s.line, { borderBottomColor: c.line }]}>
          <Text style={{ color: c.accent, fontSize: 16, fontWeight: "500" }}>Words Bo listens for</Text>
          <Text style={{ color: c.muted, fontSize: 15 }}>{wordCount ?? ""}</Text>
        </Pressable>
      </Group>

      <Group c={c} title="AI">
        <Button c={c} label="AI usage and cost" onPress={() => router.push("/ai-usage")} />
      </Group>

      <Group c={c} title="About">
        <Line c={c} label="Version" value={Constants.expoConfig?.version ?? "?"} />
        <Line c={c} label="Running" value={runningLabel()} />
        <Line c={c} label="Runtime" value={runtimeLabel()} />
        <Button c={c} label="Check for updates" onPress={() => void checkUpdates()} />
        {updateNote ? <Text style={[s.note, { color: c.muted }]}>{updateNote}</Text> : null}
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

function Line({ c, label, value, tone }: { c: Palette; label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <View style={[s.line, { borderBottomColor: c.line }]}>
      <Text style={{ color: c.ink, fontSize: 16 }}>{label}</Text>
      <Text
        style={{ color: tone === "bad" ? c.danger : tone === "good" ? c.ink : c.muted, fontSize: 15, flexShrink: 1, fontWeight: tone ? "600" : "400" }}
        numberOfLines={1}
      >
        {tone === "good" ? "✓ " : tone === "bad" ? "✗ " : ""}
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
  push: { paddingHorizontal: 14, paddingVertical: 8, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
});
