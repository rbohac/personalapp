import { useCallback, useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Alert, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Tabs, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { AreaIcon } from "../../components/AreaIcon";
import { useRemindPicker } from "../../components/RemindPicker";
import type { Entry, Goal, ItemMark, Schedule, Task } from "../../lib/api";
import { getAreas, listEntries } from "../../lib/areas";
import { useAuth } from "../../lib/auth";
import { whenLabel } from "../../lib/dates";
import { listGoals } from "../../lib/goals";
import { listTasks } from "../../lib/tasks";
import { onChanged } from "../../lib/events";
import { acceptDay, cadenceLabel, itemName, keepDay, listSchedules, markDone, setItem, shortDate, siteLabel, weekday, type ItemState } from "../../lib/schedules";
import { usePalette, type Palette } from "../../lib/theme";

/**
 * Home: what needs you now, what's coming up, this week's goals, and what
 * was logged lately — one screen, glanceable. Detail is a tap away: a daily
 * list shows one line ("8 of 8 taken") until opened.
 */
export default function HomeScreen() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
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
      const [ss, gs, ts, es] = await Promise.all([
        listSchedules(),
        listGoals().catch(() => [] as Goal[]),
        listTasks("open").catch(() => [] as Task[]),
        listEntries(undefined, 40).catch(() => [] as Entry[]),
      ]);
      setSchedules(ss);
      setGoals(gs);
      setTasks(ts);
      setRecent(es);
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
  useEffect(() => onChanged("tasks", () => void load()), [load]);
  useEffect(() => {
    getAreas().then((as) => setIcons(Object.fromEntries(as.map((a) => [a.id, a.icon ?? ""])))).catch(() => undefined);
  }, []);
  // Coming back to the app is not a focus change; refetch so "Due at 8" doesn't linger past 8.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => st === "active" && void load());
    return () => sub.remove();
  }, [load]);

  function add() {
    ActionSheetIOS.showActionSheetWithOptions({ options: ["New schedule", "New goal", "Cancel"], cancelButtonIndex: 2 }, (i) => {
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

  // Now: due, late, later today, and what's done today. Coming up: the rest.
  const rank = (s: Schedule) => ({ overdue: 0, due: 1, later: 2, done: 3, upcoming: 4, paused: 5 })[s.status.state] ?? 4;
  const now = [...schedules].filter((x) => ["overdue", "due", "later", "done"].includes(x.status.state)).sort((a, b) => rank(a) - rank(b));
  const upcoming = schedules.filter((x) => x.status.state === "upcoming");
  const soon = Date.now() + 3 * 24 * 3600e3;
  const tasksSoon = tasks
    .map((t) => ({ t, at: t.remindAt ?? t.dueAt }))
    .filter((x): x is { t: Task; at: string } => !!x.at && new Date(x.at).getTime() < soon)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 5);
  const needs = schedules.filter((x) => x.status.state === "due" || x.status.state === "overdue").length
    + tasks.filter((t) => (t.remindAt ?? t.dueAt) && new Date((t.remindAt ?? t.dueAt)!).getTime() < Date.now()).length;
  const name = state.status === "signedIn" ? (state.user.name ?? "").split(" ")[0] : "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={[s.body, { paddingTop: insets.top + 12 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
    >
      <View style={s.top}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.muted, fontSize: 15 }}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </Text>
          <Text style={{ color: c.ink, fontSize: 32, fontWeight: "700" }}>
            {greeting}
            {name ? `, ${name}` : ""}
          </Text>
        </View>
        <Pressable onPress={add} hitSlop={10} accessibilityLabel="Add a schedule or goal">
          <Ionicons name="add-circle-outline" size={30} color={c.accent} />
        </Pressable>
      </View>

      <View style={[s.strip, { backgroundColor: c.card, borderColor: c.line }]}>
        <Text style={{ color: c.ink, fontSize: 16 }}>Needs you</Text>
        <Text style={{ color: needs > 0 ? c.accent : c.muted, fontSize: 16, fontWeight: needs > 0 ? "600" : "400" }}>
          {needs > 0 ? `${needs} now` : "All caught up ✓"}
        </Text>
      </View>

      {error ? <Text style={{ color: c.danger, fontSize: 14 }}>{error}</Text> : null}

      {now.length > 0 ? <Heading c={c} text="NOW" /> : null}
      {now.map((sch) => (
        <Card key={sch.id} c={c} sch={sch} busy={busy === sch.id} onAct={act} onAskWhen={askWhen} />
      ))}

      {upcoming.length + tasksSoon.length > 0 ? <Heading c={c} text="COMING UP" /> : null}
      {upcoming.length + tasksSoon.length > 0 ? (
        <View style={[s.card, { backgroundColor: c.card, borderColor: c.line, gap: 0, paddingVertical: 4 }]}>
          {upcoming.map((sch) => (
            <Row
              key={sch.id}
              c={c}
              icon="calendar-outline"
              title={sch.title + (sch.nextSite ? ` · ${siteLabel(sch.nextSite)}` : "")}
              right={sch.status.label}
              onPress={() => router.push({ pathname: "/schedule/[id]", params: { id: sch.id } })}
            />
          ))}
          {tasksSoon.map(({ t, at }) => (
            <Row
              key={t.id}
              c={c}
              icon={t.remindAt ? "alarm-outline" : "checkbox-outline"}
              title={t.title}
              right={whenLabel(at)}
              late={new Date(at).getTime() < Date.now()}
              onPress={() => router.push({ pathname: "/task/[id]", params: { id: t.id } })}
            />
          ))}
        </View>
      ) : null}

      {goals.length > 0 ? <Week c={c} goals={goals} /> : null}

      {recent.length > 0 ? (
        <>
          <Heading c={c} text="RECENT" />
          <View style={[s.card, { backgroundColor: c.card, borderColor: c.line, gap: 0, paddingVertical: 4 }]}>
            {groupRecent(recent).slice(0, 6).map((g) => (
              <Row
                key={g.key}
                c={c}
                area={icons[g.area] ?? ""}
                title={g.title}
                right={whenLabel(g.at)}
                onPress={() => (g.id ? router.push({ pathname: "/entry/[id]", params: { id: g.id } }) : router.push({ pathname: "/area/[id]", params: { id: g.area } }))}
              />
            ))}
          </View>
        </>
      ) : null}

      {!error && !loading && schedules.length === 0 && goals.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 15 }}>Nothing scheduled yet. Tap + to add a schedule or a goal.</Text>
      ) : null}
      {remind.picker}
    </ScrollView>
  );
}

/**
 * Recent entries, with a run of medications logged together (ticking the
 * morning list) folded into one row: "Medications · 8 taken".
 */
function groupRecent(entries: Entry[]): { key: string; id: string | null; area: string; title: string; at: string }[] {
  const out: { key: string; id: string | null; area: string; title: string; at: string }[] = [];
  for (let i = 0; i < entries.length; ) {
    const e = entries[i];
    let j = i + 1;
    if (e.area === "medications") {
      while (j < entries.length && entries[j].area === "medications" && Math.abs(new Date(entries[j - 1].at).getTime() - new Date(entries[j].at).getTime()) < 30 * 60e3) j++;
    }
    const n = j - i;
    out.push(
      n > 1
        ? { key: e.id, id: null, area: e.area, title: `Medications · ${n} taken`, at: e.at }
        : { key: e.id, id: e.id, area: e.area, title: e.summary, at: e.at },
    );
    i = j;
  }
  return out;
}

function Heading({ c, text }: { c: Palette; text: string }) {
  return <Text style={{ color: c.muted, fontSize: 12, fontWeight: "600", paddingHorizontal: 4, marginTop: 8 }}>{text}</Text>;
}

function Row({ c, icon, area, title, right, late, onPress }: {
  c: Palette; icon?: keyof typeof Ionicons.glyphMap; area?: string; title: string; right: string; late?: boolean; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.row2, { borderBottomColor: c.line }]}>
      {area !== undefined ? <AreaIcon name={area} c={c} size={18} /> : <Ionicons name={icon ?? "ellipse-outline"} size={18} color={c.accent} />}
      <Text style={{ color: c.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>{title}</Text>
      <Text style={{ color: late ? c.danger : c.muted, fontSize: 13 }}>{right}</Text>
    </Pressable>
  );
}

type Act = (id: string, fn: (id: string) => Promise<Schedule>) => void;

function Card({ c, sch, busy, onAct, onAskWhen }: { c: Palette; sch: Schedule; busy: boolean; onAct: Act; onAskWhen: (id: string, items: string[]) => void }) {
  const st = sch.status.state;
  const byItem = sch.today.length > 0;
  const [open, setOpen] = useState(false);
  const taken = sch.today.filter((m) => m.state === "taken").length;
  const skipped = sch.today.filter((m) => m.state === "skipped").length;
  const later = sch.today.filter((m) => m.state === "later").length;
  const left = sch.today.length - taken - skipped - later;
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
          {sch.nextSite ? (
            <Text style={{ color: st === "due" || st === "overdue" ? tone : c.ink, fontSize: 14, fontWeight: "500" }}>
              Next: {siteLabel(sch.nextSite)}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          {st === "done" ? <Ionicons name="checkmark-circle" size={20} color={c.muted} /> : null}
          <Text style={{ color: tone, fontSize: 14, fontWeight: st === "due" || st === "overdue" ? "600" : "400" }}>{sch.status.label}</Text>
        </View>
      </View>

      {byItem ? (
        <Pressable onPress={() => setOpen((o) => !o)} style={[s.summary, { borderColor: c.line }]} hitSlop={4}>
          <View style={[s.track, { flex: 1, backgroundColor: c.track }]}>
            <View style={[s.fill, { width: `${(100 * (taken + skipped)) / sch.today.length}%`, backgroundColor: c.chart }]} />
          </View>
          <Text style={{ color: c.ink, fontSize: 14 }}>
            {taken} of {sch.today.length} taken
            {skipped ? ` · ${skipped} skipped` : ""}
            {later ? ` · ${later} later` : ""}
            {left && taken ? ` · ${left} left` : ""}
          </Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={c.muted} />
        </Pressable>
      ) : null}
      {byItem && open ? (
        <ItemChips c={c} sch={sch} onAct={onAct} onAskWhen={onAskWhen} />
      ) : !byItem && sch.items.length > 0 && !dimmed ? (
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
          {byItem && !open && left > 0 ? (
            <Pressable onPress={() => setOpen(true)} style={[s.done, { borderColor: c.line }]}>
              <Text style={{ color: c.ink, fontSize: 15 }}>Tick some</Text>
            </Pressable>
          ) : null}
          {byItem && open && sch.today.some((m) => m.state === "open") ? (
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
      if (m.byEntry) Alert.alert("Logged already", `An entry you logged today names ${itemName(m.item)}. Open it under Recent and delete it to untick.`);
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

/** One day of a per-day goal: a short bar, full when the target was reached. */
function DayBars({ c, g }: { c: Palette; g: Goal }) {
  const target = Number(g.target);
  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "flex-end", height: 28 }}>
      {g.days.map((d) => {
        const v = Number(d.value);
        const h = Math.max(3, Math.min(28, target > 0 ? (28 * v) / target : 0));
        const label = new Date(d.day + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" });
        return (
          <View key={d.day} style={{ alignItems: "center", gap: 2, flex: 1 }}>
            <View style={{ width: "100%", height: h, borderRadius: 3, backgroundColor: d.met ? c.chart : c.track }} />
            <Text style={{ color: c.muted, fontSize: 10 }}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** This week's goals: a bar each, filled toward the target. A per-day goal shows today and the last 7 days. */
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
              {g.period === "day" ? (
                <>
                  <DayBars c={c} g={g} />
                  <Text style={{ color: c.muted, fontSize: 12 }}>
                    {g.progress.daysMet} {Number(g.progress.daysMet) === 1 ? "day" : "days"} this week · last week {g.progress.lastWeek}
                  </Text>
                </>
              ) : (
                <Text style={{ color: c.muted, fontSize: 12 }}>Last week {Number(g.progress.lastWeek).toLocaleString(undefined, { maximumFractionDigits: 1 })}</Text>
              )}
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
  top: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginBottom: 4 },
  strip: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  row2: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  summary: { flexDirection: "row", alignItems: "center", gap: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
});
