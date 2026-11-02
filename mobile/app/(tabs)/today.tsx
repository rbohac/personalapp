import { useCallback, useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, Tabs, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useRemindPicker } from "../../components/RemindPicker";
import type { Goal, ItemMark, Schedule } from "../../lib/api";
import { listGoals } from "../../lib/goals";
import { onChanged } from "../../lib/events";
import { acceptDay, cadenceLabel, itemName, keepDay, listSchedules, markDone, setItem, shortDate, weekday, type ItemState } from "../../lib/schedules";
import { usePalette, type Palette } from "../../lib/theme";

/** What's due: each schedule with where it stands, the list of what to take, and Done. */
export default function TodayScreen() {
  const c = usePalette();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Set from a push ("Not taken yet…"): ask when to remind about what's left.
  const { ask: askParam } = useLocalSearchParams<{ ask?: string }>();
  // A ref, not state: the sheet's callback runs before a re-render would land.
  const remindFor = useRef<{ id: string; items: string[] } | null>(null);
  const remind = useRemindPicker(c, (at) => {
    const target = remindFor.current;
    if (!target) return;
    void act(target.id, async (id) => {
      let last: Schedule | null = null;
      for (const item of target.items) last = await setItem(id, item, "later", at);
      return last!;
    });
  });

  function askWhen(id: string, items: string[]) {
    if (items.length === 0) return;
    remindFor.current = { id, items };
    remind.ask(items.length === 1 ? `Remind me to take ${itemName(items[0])}` : `Remind me about ${items.length} items`);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ss, gs] = await Promise.all([listSchedules(), listGoals().catch(() => [] as Goal[])]);
      setSchedules(ss);
      setGoals(gs);
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
  useEffect(() => onChanged("goals", () => void load()), [load]);

  function add() {
    ActionSheetIOS.showActionSheetWithOptions({ options: ["New schedule", "New weekly goal", "Cancel"], cancelButtonIndex: 2 }, (i) => {
      if (i === 0) router.push({ pathname: "/schedule/[id]", params: { id: "new" } });
      if (i === 1) router.push({ pathname: "/goal/[id]", params: { id: "new" } });
    });
  }

  // Arriving from a "not taken yet" push: ask once the list has loaded.
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => {
    if (!askParam || asked === askParam) return;
    const sch = schedules.find((x) => x.id === askParam);
    if (!sch) return;
    setAsked(askParam);
    askWhen(sch.id, sch.today.filter((m) => m.state === "open").map((m) => m.item));
  }, [askParam, schedules]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <Pressable onPress={add} hitSlop={10} style={{ paddingHorizontal: 16 }}>
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
        <Card key={sch.id} c={c} sch={sch} busy={busy === sch.id} onAct={act} onAskWhen={askWhen} />
      ))}
      {goals.length > 0 ? <Week c={c} goals={goals} /> : null}
      {remind.picker}
    </ScrollView>
  );
}

type Act = (id: string, fn: (id: string) => Promise<Schedule>) => void;

function Card({ c, sch, busy, onAct, onAskWhen }: { c: Palette; sch: Schedule; busy: boolean; onAct: Act; onAskWhen: (id: string, items: string[]) => void }) {
  const st = sch.status.state;
  const byItem = sch.today.length > 0;
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

      {byItem ? (
        <ItemChips c={c} sch={sch} onAct={onAct} onAskWhen={onAskWhen} />
      ) : sch.items.length > 0 && !dimmed ? (
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
              {st === "upcoming" ? "Log it now" : byItem ? "Took all" : "Done"}
            </Text>
          </Pressable>
          {byItem && sch.today.some((m) => m.state === "open") ? (
            <Pressable
              onPress={() => onAskWhen(sch.id, sch.today.filter((m) => m.state === "open").map((m) => m.item))}
              style={[s.done, { borderColor: c.line }]}
            >
              <Text style={{ color: c.ink, fontSize: 15 }}>Remind me later</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * A daily list as buttons: tap to tick taken (tap again to untick); hold for
 * skip today or remind me later. Colour says the state at a glance.
 */
function ItemChips({ c, sch, onAct, onAskWhen }: { c: Palette; sch: Schedule; onAct: Act; onAskWhen: (id: string, items: string[]) => void }) {
  const set = (m: ItemMark, state: ItemState) => onAct(sch.id, (id) => setItem(id, m.item, state));

  function tap(m: ItemMark) {
    if (m.state === "taken") {
      if (m.byEntry) Alert.alert("Logged already", `An entry you logged today names ${itemName(m.item)}. Delete it on the Log screen to untick.`);
      else set(m, "open");
    } else set(m, "taken");
  }

  function hold(m: ItemMark) {
    const options = ["Taken", "Skip today", "Remind me later…", ...(m.state !== "open" && !m.byEntry ? ["Not yet (untick)"] : []), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions({ title: m.item, options, cancelButtonIndex: options.length - 1 }, (i) => {
      const pick = options[i];
      if (pick === "Taken") set(m, "taken");
      else if (pick === "Skip today") set(m, "skipped");
      else if (pick === "Remind me later…") onAskWhen(sch.id, [m.item]);
      else if (pick === "Not yet (untick)") set(m, "open");
    });
  }

  return (
    <View style={s.chips}>
      {sch.today.map((m) => {
        const look =
          m.state === "taken" ? { bg: c.accent, border: c.accent, ink: c.accentInk, icon: "checkmark" as const }
          : m.state === "skipped" ? { bg: c.bg, border: c.line, ink: c.muted, icon: "remove" as const }
          : m.state === "later" ? { bg: c.bg, border: c.late, ink: c.late, icon: "time-outline" as const }
          : { bg: c.card, border: c.accent, ink: c.ink, icon: null };
        return (
          <Pressable
            key={m.item}
            onPress={() => tap(m)}
            onLongPress={() => hold(m)}
            delayLongPress={350}
            style={({ pressed }) => [s.chip, { backgroundColor: look.bg, borderColor: look.border, opacity: pressed ? 0.6 : 1 }]}
          >
            {look.icon ? <Ionicons name={look.icon} size={16} color={look.ink} /> : null}
            <Text style={{ color: look.ink, fontSize: 15, fontWeight: m.state === "taken" ? "600" : "400", textDecorationLine: m.state === "skipped" ? "line-through" : "none" }}>
              {m.item}
              {m.state === "later" && m.remindAt ? ` · ${new Date(m.remindAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** This week's goals: a bar each, filled toward the target. */
function Week({ c, goals }: { c: Palette; goals: Goal[] }) {
  const left = Number(goals[0].progress.daysLeft);
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: "600", paddingHorizontal: 4 }}>
        THIS WEEK · {left === 1 ? "LAST DAY" : `${left} DAYS LEFT`}
      </Text>
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.line, gap: 14 }]}>
        {goals.map((g) => {
          const value = Number(g.progress.value);
          const target = Number(g.progress.target);
          const share = Math.min(1, target > 0 ? value / target : 0);
          return (
            <Pressable key={g.id} onPress={() => router.push({ pathname: "/goal/[id]", params: { id: g.id } })} style={{ gap: 6, opacity: g.paused ? 0.5 : 1 }}>
              <View style={s.head}>
                <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600", flex: 1 }}>
                  {g.progress.met ? "✓ " : ""}
                  {g.title}
                </Text>
                <Text style={{ color: g.progress.met ? c.ink : c.muted, fontSize: 14 }}>{g.paused ? "Paused" : g.progress.label}</Text>
              </View>
              <View style={[s.track, { backgroundColor: c.track }]}>
                <View style={[s.fill, { width: `${share * 100}%`, backgroundColor: c.chart }]} />
              </View>
              <Text style={{ color: c.muted, fontSize: 12 }}>Last week {Number(g.progress.lastWeek).toLocaleString(undefined, { maximumFractionDigits: 1 })}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
});
