import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { API_URL } from "../lib/config";
import { outboxAll, pendingAll, type OutboxRow } from "../lib/local";
import { clearNetLog, netEvents, type NetEvent } from "../lib/netlog";
import { check, discardQueued, useSync, wake } from "../lib/offline";
import { usePalette, type Palette } from "../lib/theme";

type Check = { label: string; ok: boolean; detail: string; ms: number };

/**
 * Settings → Connection: is it the phone, the internet or Bo's server? Runs
 * three checks, shows what's waiting to send (and lets one stuck change be
 * dropped), and the last requests with their errors in the system's words.
 * Share sends the lot as text, to paste into a conversation about it.
 */
export default function ConnectionScreen() {
  const c = usePalette();
  const sync = useSync();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const [queued, setQueued] = useState<OutboxRow[]>([]);
  const [log, setLog] = useState<NetEvent[]>([]);
  const pendingCaptures = pendingAll().filter((p) => !p.result).length;

  const refresh = useCallback(() => {
    setQueued(outboxAll());
    setLog([...netEvents()]);
  }, []);
  useFocusEffect(useCallback(() => {
    refresh();
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  async function run() {
    setRunning(true);
    const [internet, health, signedIn] = await Promise.all([
      check("https://captive.apple.com/hotspot-detect.html", false),
      check(`${API_URL}/healthz`, false),
      check(`${API_URL}/me`, true),
    ]);
    setChecks([
      { label: "Internet", ...internet },
      { label: "Bo's server", ...health },
      { label: "Signed in", ...signedIn },
    ]);
    setRunning(false);
    refresh();
  }

  function report(): string {
    const lines = [
      `Bo connection report · ${new Date().toString()}`,
      `API ${API_URL} · ${sync.online ? "online" : `offline (${sync.reason ?? "?"})`} · last error: ${sync.lastError ?? "none"}`,
      ...(checks ?? []).map((k) => `${k.label}: ${k.ok ? "OK" : "FAIL"} ${k.detail} ${k.ms} ms`),
      `Waiting: ${queued.length} change(s), ${pendingCaptures} capture(s)`,
      ...queued.map((q) => `  ${q.method} ${q.path} · tries ${q.tries} · ${q.error ?? ""}`),
      "Recent requests:",
      ...log.map((e) => `  ${new Date(e.at).toLocaleTimeString()} ${e.method} ${e.path} → ${e.status ?? e.error} ${e.ms} ms${e.retry ? " (retry)" : ""}`),
    ];
    return lines.join("\n");
  }

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={running} onRefresh={() => void run()} tintColor={c.accent} />}>
      <Heading c={c} title="Checks" />
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
        {checks === null ? <ActivityIndicator color={c.accent} style={{ padding: 12 }} /> : null}
        {(checks ?? []).map((k) => (
          <View key={k.label} style={[s.row, { borderBottomColor: c.line }]}>
            <Text style={{ color: k.ok ? c.ink : c.danger, fontSize: 16, fontWeight: "600", width: 22 }}>{k.ok ? "✓" : "✗"}</Text>
            <Text style={{ color: c.ink, fontSize: 16, flex: 1 }}>{k.label}</Text>
            <Text style={{ color: k.ok ? c.muted : c.danger, fontSize: 13, flexShrink: 1, textAlign: "right" }} numberOfLines={3}>
              {k.detail} · {k.ms} ms
            </Text>
          </View>
        ))}
        <Text style={{ color: c.muted, fontSize: 13, paddingVertical: 10 }}>{verdict(checks)}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn c={c} label={running ? "Checking…" : "Run again"} onPress={() => void run()} />
        <Btn c={c} label="Send waiting now" onPress={() => void wake().finally(refresh)} />
        <Btn c={c} label="Share report" onPress={() => void Share.share({ message: report() })} />
      </View>

      <Heading c={c} title={`Waiting to send · ${queued.length} change${queued.length === 1 ? "" : "s"}${pendingCaptures ? ` · ${pendingCaptures} capture${pendingCaptures === 1 ? "" : "s"}` : ""}`} />
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
        {queued.length === 0 ? <Text style={{ color: c.muted, fontSize: 15, paddingVertical: 10 }}>Nothing waiting.</Text> : null}
        {queued.map((q) => (
          <Pressable
            key={q.id}
            onLongPress={() =>
              Alert.alert("Drop this change?", `${q.method} ${q.path}\nIt won't be sent. Use this only if it's stuck and holding up the rest.`, [
                { text: "Cancel", style: "cancel" },
                { text: "Drop it", style: "destructive", onPress: () => { discardQueued(q.id); refresh(); } },
              ])
            }
            style={[s.row, { borderBottomColor: c.line }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.ink, fontSize: 15 }}>{q.method} {q.path.split("?")[0]}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>
                {new Date(q.created_at).toLocaleString()} · tried {q.tries}×{q.error ? ` · ${q.error}` : ""}
              </Text>
            </View>
          </Pressable>
        ))}
        {queued.length > 0 ? <Text style={{ color: c.muted, fontSize: 12, paddingVertical: 8 }}>Hold a change to drop it if it's stuck.</Text> : null}
      </View>

      <Heading c={c} title="Recent requests" />
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
        {log.length === 0 ? <Text style={{ color: c.muted, fontSize: 15, paddingVertical: 10 }}>None yet.</Text> : null}
        {log.map((e, i) => {
          const bad = e.error !== null || (e.status ?? 0) >= 400;
          return (
            <View key={i} style={[s.row, { borderBottomColor: c.line, alignItems: "flex-start" }]}>
              <Text style={{ color: c.muted, fontSize: 12, width: 64 }}>{new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</Text>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ color: c.ink, fontSize: 13 }} numberOfLines={1}>{e.method} {e.path}{e.retry ? " · retry" : ""}</Text>
                <Text style={{ color: bad ? c.danger : c.muted, fontSize: 12 }} numberOfLines={3}>{e.status ?? e.error} · {e.ms} ms</Text>
              </View>
            </View>
          );
        })}
      </View>
      {log.length > 0 ? (
        <Pressable onPress={() => { clearNetLog(); refresh(); }} style={{ alignSelf: "center", padding: 10 }}>
          <Text style={{ color: c.accent, fontSize: 15 }}>Clear the log</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function verdict(checks: Check[] | null): string {
  if (!checks) return "Checking…";
  const [net, server, me] = checks;
  if (!net.ok) return "No internet from this phone (Wi-Fi or cellular). Bo will catch up when it's back.";
  if (!server.ok) return "The internet works but Bo's server isn't answering. That's on the server side, not your phone.";
  if (!me.ok) return "The server answers but didn't accept your sign-in. Signing out and back in should fix it.";
  const slow = Math.max(server.ms, me.ms);
  return slow > 3000 ? `All reachable, but slow (${slow} ms). Bo will use saved copies while it waits.` : "All good.";
}

function Heading({ c, title }: { c: Palette; title: string }) {
  return <Text style={[s.heading, { color: c.muted }]}>{title.toUpperCase()}</Text>;
}

function Btn({ c, label, onPress }: { c: Palette; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.btn, { borderColor: c.line, backgroundColor: c.card }]}>
      <Text style={{ color: c.accent, fontSize: 14, fontWeight: "600", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  heading: { fontSize: 12, fontWeight: "600", paddingHorizontal: 4, marginTop: 8 },
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  btn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 6 },
});
