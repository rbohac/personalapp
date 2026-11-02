import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, Tabs, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { Schedule } from "../../lib/api";
import { onChanged } from "../../lib/events";
import { acceptDay, cadenceLabel, keepDay, listSchedules, markDone, shortDate, weekday } from "../../lib/schedules";
import { usePalette, type Palette } from "../../lib/theme";

/** What's due: each schedule with where it stands, the list of what to take, and Done. */
export default function TodayScreen() {
  const c = usePalette();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSchedules(await listSchedules());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load schedules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onChanged("schedules", () => void load()), [load]);
  useEffect(() => onChanged("entries", () => void load()), [load]);

  async function act(id: string, fn: (id: string) => Promise<Schedule>) {
    setBusy(id);
    try {
      await fn(id);
    } catch (e) {
      Alert.alert("Didn't go through", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setBusy(null);
    }
  }

  // Due and late first, then the rest of today, then later days, then paused.
  const rank = (s: Schedule) => ({ overdue: 0, due: 1, later: 2, done: 3, upcoming: 4, paused: 5 })[s.status.state] ?? 4;
  const sorted = [...schedules].sort((a, b) => rank(a) - rank(b));

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={s.body}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
    >
      <Tabs.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push({ pathname: "/schedule/[id]", params: { id: "new" } })} hitSlop={10} style={{ paddingHorizontal: 16 }}>
              <Ionicons name="add" size={26} color={c.accent} />
            </Pressable>
          ),
        }}
      />
      {error ? <Text style={{ color: c.danger, fontSize: 14 }}>{error}</Text> : null}
      {!error && !loading && schedules.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 15 }}>No schedules yet. Tap + to add one.</Text>
      ) : null}
      {sorted.map((sch) => (
        <Card key={sch.id} c={c} sch={sch} busy={busy === sch.id} onAct={act} />
      ))}
    </ScrollView>
  );
}

function Card({ c, sch, busy, onAct }: { c: Palette; sch: Schedule; busy: boolean; onAct: (id: string, fn: (id: string) => Promise<Schedule>) => void }) {
  const st = sch.status.state;
  const tone = st === "overdue" ? c.danger : st === "due" ? c.accent : st === "done" ? c.muted : c.ink;
  const canDone = st !== "done" && st !== "paused";
  const dimmed = st === "done" || st === "paused" || st === "upcoming";

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/schedule/[id]", params: { id: sch.id } })}
      style={[s.card, { backgroundColor: c.card, borderColor: st === "due" || st === "overdue" ? tone : c.line }]}
    >
      <View style={s.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600", opacity: dimmed ? 0.75 : 1 }}>{sch.title}</Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>{cadenceLabel(sch)}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          {st === "done" ? <Ionicons name="checkmark-circle" size={20} color={c.muted} /> : null}
          <Text style={{ color: tone, fontSize: 14, fontWeight: st === "due" || st === "overdue" ? "600" : "400" }}>{sch.status.label}</Text>
        </View>
      </View>

      {sch.items.length > 0 && !dimmed ? (
        <View style={{ gap: 3 }}>
          {sch.items.map((i) => (
            <Text key={i} style={{ color: c.ink, fontSize: 15 }}>
              • {i}
            </Text>
          ))}
        </View>
      ) : null}

      {sch.shiftedFrom && sch.nextDue ? (
        <View style={[s.banner, { borderColor: c.line }]}>
          <Text style={{ color: c.ink, fontSize: 14 }}>
            Logged off schedule, so the next one moved to {shortDate(sch.nextDue)}.
          </Text>
          <View style={s.row}>
            <Small c={c} label={`Keep ${weekday(sch.shiftedFrom)}s`} onPress={() => onAct(sch.id, keepDay)} />
            <Small c={c} label={`${weekday(sch.nextDue)}s are fine`} onPress={() => onAct(sch.id, acceptDay)} />
          </View>
        </View>
      ) : null}

      {canDone ? (
        <View style={s.row}>
          <Pressable
            onPress={() => onAct(sch.id, markDone)}
            disabled={busy}
            style={[s.done, { backgroundColor: st === "upcoming" || st === "later" ? c.bg : c.accent, borderColor: c.accent, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={{ color: st === "upcoming" || st === "later" ? c.accent : c.accentInk, fontSize: 15, fontWeight: "600" }}>
              {st === "upcoming" ? "Log it now" : "Done"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function Small({ c, label, onPress }: { c: Palette; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.small, { borderColor: c.accent }]}>
      <Text style={{ color: c.accent, fontSize: 14, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  head: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  banner: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 8 },
  small: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  done: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
});
