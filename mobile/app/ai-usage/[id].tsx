import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import type { AiCallDetail } from "../../lib/api";
import { money, num, OUTCOME, tokens, usageCall } from "../../lib/ai";
import { whenLabel } from "../../lib/dates";
import { usePalette, type Palette } from "../../lib/theme";

/** One model call: what it cost and how it went, and (within the retention window) the words. */
export default function AiCallScreen() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<AiCallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usageCall(id).then(setDetail).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the call."));
  }, [id]);

  if (!detail) {
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        {error ? <Text style={{ color: c.danger }}>{error}</Text> : <ActivityIndicator color={c.accent} />}
      </View>
    );
  }

  const { call, log } = detail;
  const o = OUTCOME[call.outcome] ?? { label: call.outcome, problem: true };
  const proposals = Array.isArray(log?.proposals) ? (log!.proposals as { areaName?: string; summary?: string; problems?: string[] }[]) : [];

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body}>
      <Section c={c} title={o.label}>
        <Row c={c} k="When" v={whenLabel(call.at)} />
        <Row c={c} k="Model" v={call.provider ? `${call.provider} / ${call.model}` : "None (patterns)"} />
        <Row c={c} k="Cost" v={money(call.costUsd)} />
        <Row c={c} k="Time" v={call.latencyMs != null ? `${(num(call.latencyMs) / 1000).toFixed(1)} s` : "—"} />
        <Row c={c} k="Tokens in / out" v={`${tokens(call.inputTokens)} / ${tokens(call.outputTokens)}`} />
        {num(call.cacheReadTokens) + num(call.cacheWriteTokens) > 0 ? (
          <Row c={c} k="Cache read / write" v={`${tokens(call.cacheReadTokens)} / ${tokens(call.cacheWriteTokens)}`} />
        ) : null}
        <Row c={c} k="Kept" v={`${num(call.kept)} of ${num(call.proposals)}`} />
      </Section>

      {log ? (
        <>
          <Section c={c} title={log.source === "voice" ? "What you said" : "What you typed"}>
            <Text style={[s.quote, { color: c.ink }]}>{log.input}</Text>
          </Section>
          {log.note || log.error ? (
            <Section c={c} title={log.error ? "Error" : "Note"}>
              <Text style={{ color: log.error ? c.danger : c.ink, fontSize: 15 }}>{log.error ?? log.note}</Text>
            </Section>
          ) : null}
          <Section c={c} title="What it understood">
            {proposals.length === 0 ? <Text style={{ color: c.muted }}>Nothing.</Text> : null}
            {proposals.map((p, i) => (
              <View key={i} style={{ gap: 2 }}>
                <Text style={{ color: c.ink, fontSize: 15 }}>
                  <Text style={{ color: c.muted }}>{p.areaName}: </Text>{p.summary}
                </Text>
                {(p.problems ?? []).map((x) => (
                  <Text key={x} style={{ color: c.danger, fontSize: 13 }}>{x}</Text>
                ))}
              </View>
            ))}
          </Section>
          {log.request ? <Raw c={c} title="Sent to the model" text={log.request} /> : null}
          {log.response ? <Raw c={c} title="Model's raw answer" text={pretty(log.response)} /> : null}
        </>
      ) : (
        <Text style={{ color: c.muted, textAlign: "center", marginTop: 8 }}>
          The words for this call are past the retention window and were deleted. Its cost stays.
        </Text>
      )}
    </ScrollView>
  );
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function Section({ c, title, children }: { c: Palette; title: string; children: React.ReactNode }) {
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
      <Text style={[s.title, { color: c.muted }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Row({ c, k, v }: { c: Palette; k: string; v: string }) {
  return (
    <View style={s.row}>
      <Text style={{ color: c.muted, fontSize: 15 }}>{k}</Text>
      <Text style={{ color: c.ink, fontSize: 15, flexShrink: 1, textAlign: "right" }}>{v}</Text>
    </View>
  );
}

/** Collapsed by default: raw prompts and answers are for debugging, not reading every time. */
function Raw({ c, title, text }: { c: Palette; title: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
      <Pressable onPress={() => setOpen((x) => !x)} style={s.row}>
        <Text style={[s.title, { color: c.muted }]}>{title.toUpperCase()}</Text>
        <Text style={{ color: c.accent, fontSize: 14 }}>{open ? "Hide" : "Show"}</Text>
      </Pressable>
      {open ? <Text selectable style={[s.mono, { color: c.ink }]}>{text}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 12 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 8 },
  title: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  quote: { fontSize: 17, lineHeight: 24 },
  mono: { fontFamily: "Menlo", fontSize: 12, lineHeight: 17 },
});
