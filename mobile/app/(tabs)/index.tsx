import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { AreaIcon } from "../../components/AreaIcon";
import type { CaptureResult, Entry, Proposal } from "../../lib/api";
import { getAreas, listEntries } from "../../lib/areas";
import { capture, saveProposal, type CaptureSource } from "../../lib/capture";
import { whenLabel } from "../../lib/dates";
import { onChanged } from "../../lib/events";
import { usePalette, type Palette } from "../../lib/theme";
import { useDictation } from "../../lib/voice";

/**
 * Log: say or type what happened, see what Bo understood, keep what's right.
 * Nothing is saved until Save — a misheard number never lands silently.
 */
export default function LogScreen() {
  const c = usePalette();
  const [text, setText] = useState("");
  const [source, setSource] = useState<CaptureSource>("typed");
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [read, setRead] = useState("");
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});

  const dictation = useDictation((t) => {
    setText(t);
    setSource("voice");
  });

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await listEntries(undefined, 15));
    } catch {
      /* the capture box still works; the list fills in next time */
    }
  }, []);

  useFocusEffect(useCallback(() => void loadRecent(), [loadRecent]));
  useEffect(() => onChanged("entries", () => void loadRecent()), [loadRecent]);
  useEffect(() => {
    getAreas().then((as) => setIcons(Object.fromEntries(as.map((a) => [a.id, a.icon ?? ""])))).catch(() => undefined);
  }, []);

  async function readIt(words = text, from = source) {
    const t = words.trim();
    if (!t) return;
    setReading(true);
    try {
      const r = await capture(t, from);
      setResult(r);
      setRead(t);
      // Anything that can't be saved as is starts unticked.
      setSkip(new Set(r.proposals.flatMap((p, i) => (p.problems.length ? [i] : []))));
    } catch (e) {
      Alert.alert("Couldn't read that", e instanceof Error ? e.message : "The server didn't answer.");
    } finally {
      setReading(false);
    }
  }

  // When dictation stops on its own, read what was heard straight away.
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !dictation.listening && text.trim()) void readIt(text, "voice");
    wasListening.current = dictation.listening;
    // readIt is stable enough for this: it reads the latest text passed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.listening]);

  function reset() {
    setText("");
    setSource("typed");
    setResult(null);
    setSkip(new Set());
  }

  async function saveAll() {
    if (!result) return;
    const keep = result.proposals.filter((p, i) => !skip.has(i) && p.problems.length === 0);
    setSaving(true);
    try {
      for (const p of keep) await saveProposal(p, read, source);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      void loadRecent();
    } catch (e) {
      Alert.alert("Not everything saved", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setSaving(false);
    }
  }

  /** A proposal with something missing opens the entry form with what was understood filled in. */
  function fix(p: Proposal) {
    if (p.kind !== "entry") return;
    router.push({ pathname: "/entry/[id]", params: { id: "new", area: p.area, at: p.at, data: JSON.stringify(p.data), raw: read, source } });
  }

  const keepCount = result ? result.proposals.filter((p, i) => !skip.has(i) && p.problems.length === 0).length : 0;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
      <View style={[s.box, { backgroundColor: c.card, borderColor: dictation.listening ? c.accent : c.line }]}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setSource("typed");
          }}
          placeholder="Took my BP, 120/80, pulse 72"
          placeholderTextColor={c.muted}
          style={[s.input, { color: c.ink }]}
          multiline
          blurOnSubmit
          returnKeyType="go"
          onSubmitEditing={() => void readIt()}
        />
        <View style={s.boxActions}>
          <Pressable
            onPress={() => (dictation.listening ? dictation.stop() : void dictation.start())}
            style={[s.mic, { backgroundColor: dictation.listening ? c.accent : c.bg }]}
            accessibilityLabel={dictation.listening ? "Stop listening" : "Speak"}
          >
            <Ionicons name={dictation.listening ? "stop" : "mic"} size={24} color={dictation.listening ? c.accentInk : c.accent} />
          </Pressable>
          <Pressable onPress={() => void readIt()} disabled={reading || !text.trim()} style={[s.read, { backgroundColor: c.accent, opacity: reading || !text.trim() ? 0.4 : 1 }]}>
            {reading ? <ActivityIndicator color={c.accentInk} /> : <Text style={[s.readText, { color: c.accentInk }]}>Read</Text>}
          </Pressable>
        </View>
      </View>
      {dictation.listening ? <Text style={[s.hint, { color: c.accent }]}>Listening…</Text> : null}
      {dictation.error ? <Text style={[s.hint, { color: c.danger }]}>{dictation.error}</Text> : null}

      {result ? (
        <View style={s.section}>
          {result.note ? <Text style={[s.note, { color: c.muted }]}>{result.note}</Text> : null}
          {result.proposals.length === 0 ? <Text style={[s.note, { color: c.ink }]}>Nothing to log in that. Try saying it another way.</Text> : null}
          {result.proposals.map((p, i) => (
            <ProposalCard
              key={i}
              p={p}
              c={c}
              kept={!skip.has(i) && p.problems.length === 0}
              onToggle={() => setSkip((prev) => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })}
              onFix={() => fix(p)}
            />
          ))}
          <View style={s.row}>
            <Pressable onPress={reset} style={[s.secondary, { borderColor: c.line }]}>
              <Text style={{ color: c.muted, fontSize: 16 }}>Discard</Text>
            </Pressable>
            <Pressable onPress={() => void saveAll()} disabled={saving || keepCount === 0} style={[s.primary, { backgroundColor: c.accent, opacity: saving || keepCount === 0 ? 0.4 : 1 }]}>
              {saving ? <ActivityIndicator color={c.accentInk} /> : <Text style={[s.readText, { color: c.accentInk }]}>Save {keepCount || ""}</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={s.section}>
        <Text style={[s.heading, { color: c.muted }]}>RECENT</Text>
        {recent.length === 0 ? <Text style={[s.note, { color: c.muted }]}>Nothing logged yet.</Text> : null}
        {recent.map((e) => (
          <Pressable key={e.id} onPress={() => router.push({ pathname: "/entry/[id]", params: { id: e.id } })} style={[s.recent, { borderBottomColor: c.line }]}>
            <AreaIcon name={icons[e.area] ?? ""} c={c} size={18} />
            <Text style={[s.recentText, { color: c.ink }]} numberOfLines={1}>{e.summary}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>{whenLabel(e.at)}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function ProposalCard({ p, c, kept, onToggle, onFix }: { p: Proposal; c: Palette; kept: boolean; onToggle: () => void; onFix: () => void }) {
  const blocked = p.problems.length > 0;
  const when = p.task?.remindAt ? `Remind ${whenLabel(p.task.remindAt)}` : p.task?.dueAt ? `Due ${whenLabel(p.task.dueAt)}` : p.kind === "entry" ? whenLabel(p.at) : null;
  return (
    <Pressable onPress={blocked ? onFix : onToggle} style={[s.card, { backgroundColor: c.card, borderColor: kept ? c.accent : c.line }]}>
      <AreaIcon name={p.icon} c={c} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.muted, fontSize: 13 }}>{p.areaName}{when ? ` · ${when}` : ""}</Text>
        <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600" }}>{p.summary}</Text>
        {p.problems.map((x) => (
          <Text key={x} style={{ color: c.danger, fontSize: 13 }}>{x}</Text>
        ))}
        {blocked && p.kind === "entry" ? <Text style={{ color: c.accent, fontSize: 13 }}>Tap to fill in and save</Text> : null}
      </View>
      {!blocked ? <Ionicons name={kept ? "checkmark-circle" : "ellipse-outline"} size={24} color={kept ? c.accent : c.muted} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  box: { borderRadius: 16, borderWidth: 1.5, padding: 12, gap: 10 },
  input: { fontSize: 19, minHeight: 72, textAlignVertical: "top" },
  boxActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mic: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  read: { height: 44, paddingHorizontal: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  readText: { fontSize: 16, fontWeight: "600" },
  hint: { fontSize: 14, paddingHorizontal: 4 },
  section: { gap: 10, marginTop: 8 },
  note: { fontSize: 14 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  row: { flexDirection: "row", gap: 10 },
  secondary: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  primary: { flex: 2, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 12, fontWeight: "600", marginTop: 8 },
  recent: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  recentText: { flex: 1, fontSize: 16 },
});
