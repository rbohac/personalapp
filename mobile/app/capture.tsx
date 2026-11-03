import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { AreaIcon } from "../components/AreaIcon";
import type { CaptureResult, Proposal } from "../lib/api";
import { capture, saveProposal, type CaptureSource } from "../lib/capture";
import { whenLabel } from "../lib/dates";
import { usePalette, type Palette } from "../lib/theme";
import { useDictation } from "../lib/voice";
import { pendingAdd, pendingAll, pendingDelete } from "../lib/local";
import { isOffline, notify, uuid } from "../lib/offline";

/**
 * Say or type what happened, see what Bo understood, keep what's right.
 * Opened by the mic in the middle of the tab bar, listening already
 * (?listen=1). Nothing is saved until Save — a misheard number never lands
 * silently — and saving closes it.
 */
export default function CaptureScreen() {
  const c = usePalette();
  const [text, setText] = useState("");
  const [source, setSource] = useState<CaptureSource>("typed");
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [read, setRead] = useState("");
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const { listen, pending } = useLocalSearchParams<{ listen?: string; pending?: string }>();
  const input = useRef<TextInputInstance>(null);
  // Text that was already in the box when listening started: speech adds to it.
  const before = useRef("");
  // Typing while listening means editing: stop listening and don't auto-read.
  const typedWhileListening = useRef(false);

  const dictation = useDictation((t) => {
    setText(before.current ? `${before.current} ${t}` : t);
    setSource("voice");
  });

  /** Listen, with the cursor in the box so it can be corrected by typing at any point. */
  function startListening() {
    before.current = text.trim();
    typedWhileListening.current = false;
    input.current?.focus();
    void dictation.start();
  }

  // The tab bar's mic opens this listening, cursor in the box. Opened from
  // "said while offline" it shows what Bo read, ready to review.
  useEffect(() => {
    const held = pending ? pendingAll().find((p) => p.id === pending) : undefined;
    if (held?.result) {
      setText(held.text);
      setRead(held.text);
      setSource(held.source === "voice" ? "voice" : "typed");
      const r = JSON.parse(held.result) as CaptureResult;
      setResult(r);
      setSkip(new Set(r.proposals.flatMap((p, i) => (p.problems.length ? [i] : []))));
      return () => dictation.stop();
    }
    if (listen === "1") startListening();
    else input.current?.focus();
    return () => dictation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function readIt(words = text, from = source) {
    const t = words.trim();
    if (!t) return;
    // Put the keyboard away so the proposals and Recent list are in view.
    Keyboard.dismiss();
    setReading(true);
    try {
      const r = await capture(t, from);
      setResult(r);
      setRead(t);
      // Anything that can't be saved as is starts unticked.
      setSkip(new Set(r.proposals.flatMap((p, i) => (p.problems.length ? [i] : []))));
    } catch (e) {
      if (isOffline(e)) {
        // No connection: keep the words; they're read when it's back and wait on Home for review.
        pendingAdd(uuid(), t, from);
        notify();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        reset();
        Alert.alert("Saved for later", "You're offline. Bo will read this when you're back online and ask you to review it on Home.");
        if (router.canGoBack()) router.back();
        return;
      }
      Alert.alert("Couldn't read that", e instanceof Error ? e.message : "The server didn't answer.");
    } finally {
      setReading(false);
    }
  }

  /** Done with something said offline: it no longer waits on Home. */
  function settlePending() {
    if (pending) {
      pendingDelete(pending);
      notify();
    }
  }

  // When dictation stops on its own, read what was heard straight away.
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !dictation.listening && text.trim() && !typedWhileListening.current) void readIt(text, "voice");
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
      for (const p of keep) await saveProposal(p, read, source, result.captureId);
      settlePending();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      if (router.canGoBack()) router.back();
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
    // Swipe down, or tap anywhere that isn't a control, to put the keyboard away.
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text style={{ color: c.accent, fontSize: 17 }}>Close</Text>
            </Pressable>
          ),
        }}
      />
      <Pressable onPress={() => !dictation.listening && Keyboard.dismiss()} accessible={false} style={s.body}>
      <View style={[s.box, { backgroundColor: c.card, borderColor: dictation.listening ? c.accent : c.line }]}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={(t) => {
            if (dictation.listening) {
              typedWhileListening.current = true;
              dictation.stop();
            }
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
            onPress={() => (dictation.listening ? dictation.stop() : startListening())}
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
            <Pressable
              onPress={() => {
                reset();
                if (pending) {
                  settlePending();
                  if (router.canGoBack()) router.back();
                }
              }}
              style={[s.secondary, { borderColor: c.line }]}
            >
              <Text style={{ color: c.muted, fontSize: 16 }}>Discard</Text>
            </Pressable>
            <Pressable onPress={() => void saveAll()} disabled={saving || keepCount === 0} style={[s.primary, { backgroundColor: c.accent, opacity: saving || keepCount === 0 ? 0.4 : 1 }]}>
              {saving ? <ActivityIndicator color={c.accentInk} /> : <Text style={[s.readText, { color: c.accentInk }]}>Save {keepCount || ""}</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}

      </Pressable>
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
  scroll: { flexGrow: 1 },
  body: { flexGrow: 1, padding: 16, gap: 12 },
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
