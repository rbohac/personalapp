import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";

import { DoseLogger } from "../../components/DoseLogger";
import { ItemChecklist } from "../../components/ItemChecklist";
import { useRemindPicker } from "../../components/RemindPicker";
import type { Entry, Schedule } from "../../lib/api";
import { whenLabel } from "../../lib/dates";
import { onChanged } from "../../lib/events";
import { cadenceLabel, hasDoseChoices, itemName, listSchedules, markDone, nextDoseLabel, scheduleHistory, setItem, shortDate, type ItemState } from "../../lib/schedules";
import { usePalette, type Palette } from "../../lib/theme";

/**
 * One schedule as you'd look at it: where it stands, the next dose (and
 * side), and every time it was taken. Editing is behind Edit in the corner —
 * something done rarely.
 */
export default function ScheduleView() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [sch, setSch] = useState<Schedule | null>(null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, h] = await Promise.all([listSchedules(), scheduleHistory(id)]);
      const s = all.find((x) => x.id === id);
      if (!s) {
        router.back();
        return;
      }
      setSch(s);
      setHistory(h);
    } catch (e) {
      Alert.alert("Couldn't load it", e instanceof Error ? e.message : "");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onChanged("entries", () => void load()), [load]);
  useEffect(() => onChanged("schedules", () => void load()), [load]);

  // "Remind me later": a ref, because the sheet's callback runs before a re-render would land.
  const remindFor = useRef<string[]>([]);
  const remind = useRemindPicker(c, (at) => {
    const items = remindFor.current;
    void (async () => {
      try {
        for (const item of items) setSch(await setItem(id, item, "later", at));
      } catch (e) {
        Alert.alert("Not set", e instanceof Error ? e.message : "");
      }
    })();
  });
  function askWhen(items: string[]) {
    if (items.length === 0) return;
    remindFor.current = items;
    remind.ask(items.length === 1 ? `Remind me to take ${itemName(items[0])}` : `Remind me about ${items.length} items`);
  }

  async function tick(item: string, state: ItemState) {
    try {
      setSch(await setItem(id, item, state));
    } catch (e) {
      Alert.alert("Not changed", e instanceof Error ? e.message : "");
    }
  }

  async function done(dose?: string) {
    setBusy(true);
    try {
      await markDone(id, dose);
    } catch (e) {
      Alert.alert("Not logged", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setBusy(false);
    }
  }

  if (!sch) {
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  const st = sch.status.state;
  const tone = st === "overdue" ? c.danger : st === "due" ? c.accent : c.ink;
  const next = nextDoseLabel(sch);
  const canLog = st !== "done" && st !== "paused" && st !== "finished";
  const byItem = sch.today.length > 0;
  const choices = hasDoseChoices(sch);
  const open = sch.today.filter((m) => m.state === "open").map((m) => m.item);
  const days = byItem ? groupByDay(history) : [];

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}>
      <Stack.Screen
        options={{
          title: sch.title,
          headerRight: () => (
            <Pressable onPress={() => router.push({ pathname: "/schedule/edit/[id]", params: { id } })} hitSlop={10}>
              <Text style={{ color: c.accent, fontSize: 17 }}>Edit</Text>
            </Pressable>
          ),
        }}
      />

      <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
        <Text style={{ color: tone, fontSize: 20, fontWeight: "700" }}>{sch.status.label}</Text>
        <Line c={c} label="Repeats" value={cadenceLabel(sch)} />
        {sch.nextDue ? <Line c={c} label="Next due" value={shortDate(sch.nextDue)} /> : null}
        {next ? <Line c={c} label="Next dose" value={next} /> : null}
        <Line c={c} label="Last taken" value={sch.lastDoneAt ? whenLabel(sch.lastDoneAt) : "Not logged yet"} />
        {canLog && !byItem && !choices ? (
          <Pressable onPress={() => void done()} disabled={busy} style={[s.button, { backgroundColor: c.accent, opacity: busy ? 0.5 : 1 }]}>
            <Text style={{ color: c.accentInk, fontSize: 16, fontWeight: "600" }}>{st === "upcoming" ? "Log one now" : "Done"}</Text>
          </Pressable>
        ) : null}
      </View>

      {canLog && choices && !byItem ? <DoseLogger c={c} sch={sch} busy={busy} onLog={(dose) => void done(dose)} /> : null}

      {byItem ? (
        <>
          <Text style={[s.heading, { color: c.muted }]}>TODAY · TAP TO TICK, HOLD FOR MORE</Text>
          <ItemChecklist c={c} sch={sch} onSet={(item, state) => void tick(item, state)} onAskWhen={askWhen} />
          {open.length > 0 ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => void done()} disabled={busy} style={[s.button, { flex: 1, backgroundColor: c.accent, opacity: busy ? 0.5 : 1 }]}>
                <Text style={{ color: c.accentInk, fontSize: 16, fontWeight: "600" }}>Took all</Text>
              </Pressable>
              <Pressable onPress={() => askWhen(open)} style={[s.button, { flex: 1, borderWidth: 1, borderColor: c.line }]}>
                <Text style={{ color: c.ink, fontSize: 16 }}>Remind me later</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}

      <Text style={[s.heading, { color: c.muted }]}>HISTORY</Text>
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.line, paddingVertical: 4, gap: 0 }]}>
        {history.length === 0 ? <Text style={{ color: c.muted, fontSize: 15, paddingVertical: 10 }}>Nothing logged yet.</Text> : null}
        {byItem
          ? days.map((d) => (
              <View key={d.day} style={[s.row, { borderBottomColor: c.line }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: c.ink, fontSize: 15 }}>{d.count} taken</Text>
                  <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={2}>{d.names.join(", ")}</Text>
                </View>
                <Text style={{ color: c.muted, fontSize: 13 }}>{d.label}</Text>
              </View>
            ))
          : history.map((e) => (
              <Pressable key={e.id} onPress={() => router.push({ pathname: "/entry/[id]", params: { id: e.id } })} style={[s.row, { borderBottomColor: c.line }]}>
                <Text style={{ color: c.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>{e.summary.replace(/^Taken · /, "")}</Text>
                <Text style={{ color: c.muted, fontSize: 13 }}>{whenLabel(e.at)}</Text>
              </Pressable>
            ))}
      </View>
      {remind.picker}
    </ScrollView>
  );
}

/** A daily list's history, one row per day: how many were taken and which. */
function groupByDay(entries: Entry[]) {
  const out: { day: string; label: string; count: number; names: string[] }[] = [];
  for (const e of entries) {
    const d = new Date(e.at);
    const day = d.toDateString();
    let row = out.find((r) => r.day === day);
    if (!row) {
      row = { day, label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), count: 0, names: [] };
      out.push(row);
    }
    row.count++;
    const name = typeof e.data.medication === "string" ? e.data.medication : e.summary;
    if (!row.names.includes(name)) row.names.push(name);
  }
  return out;
}

function Line({ c, label, value }: { c: Palette; label: string; value: string }) {
  return (
    <View style={s.line}>
      <Text style={{ color: c.muted, fontSize: 15 }}>{label}</Text>
      <Text style={{ color: c.ink, fontSize: 15, flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  button: { height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
  heading: { fontSize: 12, fontWeight: "600", paddingHorizontal: 4, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
});
