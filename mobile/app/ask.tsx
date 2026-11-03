import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { BarChart } from "../components/BarChart";
import type { AskChart, AskTurn } from "../lib/api";
import { ask } from "../lib/insights";
import { usePalette, type Palette } from "../lib/theme";
import { useDictation } from "../lib/voice";

type Turn = { q: string; a: string | null; chart: AskChart | null; failed?: boolean };

const SUGGESTIONS = [
  "How's my blood pressure been this month?",
  "How many nights did I snack this week?",
  "What did I eat for protein yesterday?",
  "When was my last Leqvio?",
  "How often did I skip Vyvanse?",
];

/**
 * Ask Bo about anything logged. The answer comes from your own entries,
 * schedules and goals (the last 90 days), with a small chart when one helps.
 * The conversation stays on screen for follow-ups and is gone when you leave.
 */
export default function AskScreen() {
  const c = usePalette();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const dictation = useDictation((t) => setText(t));

  // When dictation stops on its own, ask what was heard.
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !dictation.listening && text.trim()) void send(text);
    wasListening.current = dictation.listening;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.listening]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setText("");
    const history: AskTurn[] = turns.filter((t) => t.a && !t.failed).map((t) => ({ question: t.q, answer: t.a! }));
    setTurns((ts) => [...ts, { q, a: null, chart: null }]);
    setBusy(true);
    try {
      const r = await ask(q, history);
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { q, a: r.answer, chart: r.chart ?? null } : t)));
    } catch (e) {
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { q, a: e instanceof Error ? e.message : "Couldn't reach Bo.", chart: null, failed: true } : t)));
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={90} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView ref={scroll} contentContainerStyle={s.body} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
        {turns.length === 0 ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: c.muted, fontSize: 15 }}>Ask about anything you've logged. Answers come from your own entries.</Text>
            {SUGGESTIONS.map((q) => (
              <Pressable key={q} onPress={() => void send(q)} style={[s.suggest, { borderColor: c.line, backgroundColor: c.card }]}>
                <Text style={{ color: c.ink, fontSize: 15 }}>{q}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {turns.map((t, i) => (
          <View key={i} style={{ gap: 8 }}>
            <View style={[s.mine, { backgroundColor: c.accent }]}>
              <Text style={{ color: c.accentInk, fontSize: 16 }}>{t.q}</Text>
            </View>
            <View style={[s.theirs, { backgroundColor: c.card, borderColor: c.line }]}>
              {t.a === null ? (
                <ActivityIndicator color={c.accent} />
              ) : (
                <Text style={{ color: t.failed ? c.danger : c.ink, fontSize: 16, lineHeight: 22 }} selectable>
                  {t.a}
                </Text>
              )}
              {t.chart ? <Chart c={c} chart={t.chart} /> : null}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[s.bar, { borderTopColor: c.line, backgroundColor: c.bg }]}>
        <View style={[s.input, { backgroundColor: c.card, borderColor: dictation.listening ? c.accent : c.line }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={dictation.listening ? "Listening…" : "Ask about anything you've logged"}
            placeholderTextColor={c.muted}
            style={{ flex: 1, color: c.ink, fontSize: 16, paddingVertical: 8 }}
            returnKeyType="send"
            onSubmitEditing={() => void send(text)}
            multiline
            blurOnSubmit
          />
          {text.trim() && !dictation.listening ? (
            <Pressable onPress={() => void send(text)} disabled={busy} accessibilityLabel="Ask" style={[s.round, { backgroundColor: c.accent, opacity: busy ? 0.4 : 1 }]}>
              <Ionicons name="arrow-up" size={22} color={c.accentInk} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => (dictation.listening ? dictation.stop() : void dictation.start())}
              accessibilityLabel={dictation.listening ? "Stop listening" : "Ask by voice"}
              style={[s.round, { backgroundColor: dictation.listening ? c.accent : c.bg }]}
            >
              <Ionicons name={dictation.listening ? "stop" : "mic"} size={22} color={dictation.listening ? c.accentInk : c.accent} />
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Chart({ c, chart }: { c: Palette; chart: AskChart }) {
  const [selected, setSelected] = useState<string | null>(null);
  const unit = chart.unit ? ` ${chart.unit}` : "";
  const fmt = (v: number) => `${Math.round(v * 10) / 10}${unit}`;
  const sel = chart.points.find((p, i) => `${i}` === selected);
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <Text style={{ color: c.muted, fontSize: 13 }}>
        {chart.title}
        {sel ? ` · ${sel.label}: ${fmt(Number(sel.value))}` : ""}
      </Text>
      <BarChart
        c={c}
        bars={chart.points.map((p, i) => ({ key: `${i}`, value: p.value, label: p.label }))}
        selected={selected}
        onSelect={setSelected}
        format={fmt}
        height={110}
        empty="All zero"
      />
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, gap: 16 },
  suggest: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  mine: { alignSelf: "flex-end", maxWidth: "85%", borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 },
  theirs: { alignSelf: "flex-start", maxWidth: "92%", borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 4, padding: 14, gap: 8 },
  bar: { padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 16, paddingLeft: 14, paddingRight: 6, paddingVertical: 4 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
