import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";

import { BarChart } from "../components/BarChart";
import type { Trends } from "../lib/api";
import { trends } from "../lib/insights";
import { usePalette, type Palette } from "../lib/theme";

const RANGES = [7, 30, 90] as const;
const n = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Trends: the last 7, 30 or 90 days of what's logged, worked out on the
 * server from entries — blood pressure, weight and protein, Brock Road time,
 * meds, shots and sleep. Read-only; tap a bar to see its value.
 */
export default function TrendsScreen() {
  const c = usePalette();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Trends | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await trends(days));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load trends.");
    } finally {
      setLoading(false);
    }
  }, [days]);
  useEffect(() => void load(), [load]);

  const t = data;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={[s.toggle, { backgroundColor: c.card, borderColor: c.line }]}>
              {RANGES.map((r) => (
                <Pressable key={r} onPress={() => setDays(r)} style={[s.seg, { backgroundColor: days === r ? c.accent : "transparent" }]}>
                  <Text style={{ color: days === r ? c.accentInk : c.muted, fontSize: 13, fontWeight: days === r ? "600" : "400" }}>{r}d</Text>
                </Pressable>
              ))}
            </View>
          ),
        }}
      />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : null}
      {!t ? <ActivityIndicator color={c.accent} /> : (
        <>
          <Card c={c} title="Blood pressure" right={t.bloodPressure.avgSystolic ? `avg ${t.bloodPressure.avgSystolic}/${t.bloodPressure.avgDiastolic}` : "No readings"}>
            {t.bloodPressure.readings.length > 1 ? (
              <Bars
                c={c}
                points={t.bloodPressure.readings.map((r, i) => ({ key: `${i}`, value: r.systolic, label: day(r.at.slice(0, 10)), note: `${r.systolic}/${r.diastolic}${r.pulse ? ` · pulse ${r.pulse}` : ""}` }))}
                format={(v) => `${v}`}
                empty="—"
              />
            ) : null}
            <Note c={c}>
              {t.bloodPressure.readings.length} readings, systolic per reading
              {t.bloodPressure.prevAvgSystolic ? ` · the ${days} days before: ${t.bloodPressure.prevAvgSystolic}/${t.bloodPressure.prevAvgDiastolic}` : ""}
            </Note>
          </Card>

          <View style={s.grid}>
            <Tile c={c} label="Weight" value={n(t.weight.latest) !== null ? `${n(t.weight.latest)} lb` : "—"}
              note={n(t.weight.change) !== null ? `${n(t.weight.change)! > 0 ? "+" : ""}${Math.round(n(t.weight.change)! * 10) / 10} lb in ${days} d` : "Log a weight to start"} />
            <Tile c={c} label="Protein / day" value={`${Math.round(n(t.protein.average) ?? 0)} g`}
              note={n(t.protein.target) ? `target ${n(t.protein.target)} g · ${t.protein.daysMet} days met` : "Log a weight for a target"} />
            <Tile c={c} label="Brock Road" value={`${t.household.daysMet} / ${days} days`} note={`15+ min · ${Math.round(n(t.household.average) ?? 0)} min avg`} />
            <Tile c={c} label="Meds logged" value={`${t.meds.daysLogged} / ${t.meds.days} days`}
              note={t.meds.skipped.length ? t.meds.skipped.slice(0, 2).map((x) => `${x.name.split(" (")[0]} skipped ${x.count}×`).join(" · ") : "Nothing skipped"} />
          </View>

          <Card c={c} title="Protein" right={`avg ${Math.round(n(t.protein.average) ?? 0)} g`}>
            <Bars c={c} points={t.protein.days.map((d) => ({ key: d.day, value: d.value, label: day(d.day) }))} format={(v) => `${Math.round(v)} g`} empty="None logged" />
          </Card>

          <Card c={c} title="Brock Road" right={`${t.household.daysMet} days at 15+ min`}>
            <Bars c={c} points={t.household.days.map((d) => ({ key: d.day, value: d.value, label: day(d.day) }))} format={(v) => `${Math.round(v)} min`} empty="None logged" />
          </Card>

          <Card c={c} title="Sleep" right={`${t.sleep.nights} nights logged`}>
            <View style={s.grid}>
              <Small c={c} label="Without snacking" value={`${t.sleep.cleanNights} / ${t.sleep.nights}`} />
              <Small c={c} label="Carb snacks" value={`${t.sleep.carbNights}`} />
              <Small c={c} label="CPAP" value={t.sleep.avgCpapHours !== null ? `${n(t.sleep.avgCpapHours)} h${t.sleep.avgCpapScore !== null ? ` · ${t.sleep.avgCpapScore}` : ""}` : "—"} />
              <Small c={c} label="Up at night" value={t.sleep.avgAwakeMinutes !== null ? `${t.sleep.avgAwakeMinutes} min avg` : "—"} />
            </View>
            {t.sleep.awakeMinutes.length > 1 ? (
              <>
                <Note c={c}>Minutes up in the night</Note>
                <Bars c={c} points={t.sleep.awakeMinutes.map((d) => ({ key: d.day, value: d.value, label: day(d.day) }))} format={(v) => `${Math.round(v)} min`} empty="None" />
              </>
            ) : null}
          </Card>

          <Card c={c} title="Shots taken" right={`${t.shots.reduce((a, x) => a + Number(x.count), 0)} in ${days} d`}>
            {t.shots.length === 0 ? <Note c={c}>None logged.</Note> : t.shots.map((x) => (
              <View key={x.name} style={s.line}>
                <Text style={{ color: c.ink, fontSize: 15 }}>{x.name}</Text>
                <Text style={{ color: c.muted, fontSize: 15 }}>{x.count}</Text>
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function Bars({ c, points, format, empty }: { c: Palette; points: { key: string; value: number | string; label: string; note?: string }[]; format: (v: number) => string; empty: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = points.find((p) => p.key === selected);
  return (
    <View style={{ gap: 4 }}>
      {sel ? <Text style={{ color: c.ink, fontSize: 13 }}>{sel.label}: {sel.note ?? format(Number(sel.value))}</Text> : null}
      <BarChart c={c} bars={points} selected={selected} onSelect={setSelected} format={format} height={100} empty={empty} />
    </View>
  );
}

function Card({ c, title, right, children }: { c: Palette; title: string; right?: string; children: ReactNode }) {
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
      <View style={s.line}>
        <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>
        {right ? <Text style={{ color: c.muted, fontSize: 14 }}>{right}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Tile({ c, label, value, note }: { c: Palette; label: string; value: string; note: string }) {
  return (
    <View style={[s.tile, { backgroundColor: c.card, borderColor: c.line }]}>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: c.ink, fontSize: 22, fontWeight: "700" }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12 }}>{note}</Text>
    </View>
  );
}

function Small({ c, label, value }: { c: Palette; label: string; value: string }) {
  return (
    <View style={{ width: "47%", gap: 2 }}>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

function Note({ c, children }: { c: Palette; children: ReactNode }) {
  return <Text style={{ color: c.muted, fontSize: 12 }}>{children}</Text>;
}

const s = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  toggle: { flexDirection: "row", borderWidth: 1, borderRadius: 999, padding: 2, gap: 2 },
  seg: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48%", flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
});
