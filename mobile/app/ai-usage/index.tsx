import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { BarChart, type Bar } from "../../components/BarChart";
import type { AiCall, UsageSummary } from "../../lib/api";
import { dayLabel, money, num, OUTCOME, usageCalls, usageSummary } from "../../lib/ai";
import { whenLabel } from "../../lib/dates";
import { usePalette, type Palette } from "../../lib/theme";

/**
 * AI usage: this month against the budget, cost per day or week, and the calls
 * behind it. Tap a day's bar to see that day's calls; tap a call for its log.
 */
export default function AiUsageScreen() {
  const c = usePalette();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [calls, setCalls] = useState<AiCall[]>([]);
  const [range, setRange] = useState<"days" | "weeks">("days");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await usageSummary());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));

  // The list follows the selected day; with no day picked it's the latest calls.
  const day = range === "days" ? selected : null;
  useEffect(() => {
    usageCalls(day ?? undefined).then(setCalls).catch(() => setCalls([]));
  }, [day, summary]);

  if (!summary) {
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        {error ? <Text style={{ color: c.danger, padding: 24 }}>{error}</Text> : <ActivityIndicator color={c.accent} />}
      </View>
    );
  }

  const m = summary.month;
  const buckets = range === "days" ? summary.days : summary.weeks;
  const bars: Bar[] = buckets.map((b) => ({
    key: b.start,
    value: b.cost,
    label: range === "days" ? dayLabel(b.start, { month: "short", day: "numeric" }) : `wk ${dayLabel(b.start, { month: "short", day: "numeric" })}`,
  }));
  const picked = buckets.find((b) => b.start === selected);

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={s.body}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
    >
      <Budget c={c} spend={num(m.spend)} budget={num(m.budget)} projected={num(m.projected)} />

      <View style={s.tiles}>
        <Tile c={c} label="Captures" value={String(num(m.calls))} />
        <Tile c={c} label="Per capture" value={num(m.modelCalls) ? money(num(m.spend) / num(m.modelCalls)) : "—"} />
        <Tile c={c} label="Kept" value={num(m.proposals) ? `${num(m.kept)}/${num(m.proposals)}` : "—"} />
        <Tile c={c} label="Fallbacks" value={String(num(m.fallbacks))} />
      </View>
      {num(m.unknownCostCalls) > 0 ? (
        <Notice c={c} icon="help-circle-outline" text={`${num(m.unknownCostCalls)} call(s) used a model with no price on file, so this month's spend is a floor.`} />
      ) : null}

      <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
        <View style={s.cardHead}>
          <Text style={[s.cardTitle, { color: c.ink }]}>{range === "days" ? "Cost per day" : "Cost per week"}</Text>
          <View style={s.segments}>
            {(["days", "weeks"] as const).map((r) => (
              <Pressable key={r} onPress={() => { setRange(r); setSelected(null); }} style={[s.segment, range === r && { backgroundColor: c.accent }]}>
                <Text style={{ color: range === r ? c.accentInk : c.muted, fontSize: 13, fontWeight: "600" }}>{r === "days" ? "30 days" : "12 weeks"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <BarChart bars={bars} c={c} selected={selected} onSelect={setSelected} format={money} />
        <Text style={[s.hint, { color: picked ? c.ink : c.muted }]}>
          {picked
            ? `${range === "days" ? dayLabel(picked.start) : `Week of ${dayLabel(picked.start)}`} · ${money(picked.cost)} · ${num(picked.calls)} call${num(picked.calls) === 1 ? "" : "s"}`
            : range === "days" ? "Tap a day to see its calls." : "Tap a week to see its total."}
        </Text>
      </View>

      {summary.models.length ? (
        <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
          <Text style={[s.cardTitle, { color: c.ink }]}>By model this month</Text>
          {summary.models.map((x) => (
            <View key={`${x.provider}/${x.model}`} style={s.modelRow}>
              <Text style={{ color: c.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>{x.model}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{num(x.calls)} calls · {money(x.cost)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={[s.heading, { color: c.muted }]}>
        {day ? `CALLS ON ${dayLabel(day).toUpperCase()}` : "RECENT CALLS"}
      </Text>
      {calls.length === 0 ? <Text style={{ color: c.muted }}>No calls{day ? " that day" : " yet"}.</Text> : null}
      {calls.map((call) => (
        <CallRow key={call.id} call={call} c={c} />
      ))}
      <Text style={[s.foot, { color: c.muted }]}>
        What you said is kept {summary.logRetentionDays} days; costs are kept for good.
      </Text>
    </ScrollView>
  );
}

function Budget({ c, spend, budget, projected }: { c: Palette; spend: number; budget: number; projected: number }) {
  const share = budget > 0 ? spend / budget : 0;
  const over = budget > 0 && spend >= budget;
  const onPaceOver = !over && budget > 0 && projected > budget;
  const tick = budget > 0 ? Math.min(projected / budget, 1) : 0;
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
      <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600" }}>THIS MONTH</Text>
      <View style={s.heroRow}>
        <Text style={[s.hero, { color: c.ink }]}>{money(spend)}</Text>
        <Text style={{ color: c.muted, fontSize: 15 }}> of {money(budget)} budget</Text>
      </View>
      <View style={[s.track, { backgroundColor: c.track }]}>
        <View style={[s.fill, { width: `${Math.min(share, 1) * 100}%`, backgroundColor: over ? c.danger : c.chart }]} />
        {tick > 0 && !over ? <View style={[s.tick, { left: `${tick * 100}%`, backgroundColor: c.ink }]} /> : null}
      </View>
      {over ? (
        <Notice c={c} icon="alert-circle" color={c.danger} text="Budget used up. Captures use simple patterns until next month." />
      ) : onPaceOver ? (
        <Notice c={c} icon="warning-outline" color={c.late} text={`On pace for ${money(projected)}, over budget.`} />
      ) : (
        <Text style={{ color: c.muted, fontSize: 13 }}>On pace for {money(projected)} by month end (the tick).</Text>
      )}
    </View>
  );
}

function Tile({ c, label, value }: { c: Palette; label: string; value: string }) {
  return (
    <View style={[s.tile, { backgroundColor: c.card, borderColor: c.line }]}>
      <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700" }} numberOfLines={1}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Notice({ c, icon, text, color }: { c: Palette; icon: keyof typeof Ionicons.glyphMap; text: string; color?: string }) {
  return (
    <View style={s.notice}>
      <Ionicons name={icon} size={16} color={color ?? c.muted} />
      <Text style={{ color: color ?? c.muted, fontSize: 13, flex: 1 }}>{text}</Text>
    </View>
  );
}

function CallRow({ call, c }: { call: AiCall; c: Palette }) {
  const o = OUTCOME[call.outcome] ?? { label: call.outcome, problem: true };
  return (
    <Pressable onPress={() => router.push({ pathname: "/ai-usage/[id]", params: { id: call.id } })} style={[s.callRow, { borderBottomColor: c.line }]}>
      <Ionicons name={o.problem ? "alert-circle-outline" : "sparkles-outline"} size={18} color={o.problem ? c.late : c.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: call.input ? c.ink : c.muted, fontSize: 15 }} numberOfLines={1}>
          {call.input ?? "(words deleted after retention)"}
        </Text>
        <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
          {o.problem ? `${o.label} · ` : ""}{call.model ?? "patterns"} · kept {num(call.kept)}/{num(call.proposals)}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={{ color: c.ink, fontSize: 14 }}>{money(call.costUsd)}</Text>
        <Text style={{ color: c.muted, fontSize: 12 }}>{whenLabel(call.at)}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 12 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  heroRow: { flexDirection: "row", alignItems: "baseline" },
  hero: { fontSize: 32, fontWeight: "700" },
  track: { height: 10, borderRadius: 5, overflow: "visible", justifyContent: "center" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5 },
  tick: { position: "absolute", width: 2, top: -3, bottom: -3, marginLeft: -1, borderRadius: 1 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, padding: 10, borderRadius: 12, borderWidth: 1, gap: 2 },
  notice: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  segments: { flexDirection: "row", gap: 4 },
  segment: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  hint: { fontSize: 13 },
  modelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { fontSize: 12, fontWeight: "600", marginTop: 8 },
  callRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  foot: { fontSize: 12, marginTop: 8, textAlign: "center" },
});
