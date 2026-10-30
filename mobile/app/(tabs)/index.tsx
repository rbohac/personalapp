import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import type { Task } from "../../lib/api";
import { isPast, whenLabel } from "../../lib/dates";
import { onTasksChanged } from "../../lib/events";
import { createTask, listTasks, setDone, type TaskFilter } from "../../lib/tasks";
import { usePalette, type Palette } from "../../lib/theme";

export default function TasksScreen() {
  const c = usePalette();
  const [filter, setFilter] = useState<Exclude<TaskFilter, "all">>("open");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await listTasks(filter));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load tasks.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Refetch on focus, when the app comes back, and when something else changed tasks.
  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => {
    const app = AppState.addEventListener("change", (s) => s === "active" && void load());
    const off = onTasksChanged(() => void load());
    return () => {
      app.remove();
      off();
    };
  }, [load]);

  async function add() {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    try {
      await createTask({ title });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (filter === "open") void load();
    } catch (e) {
      setDraft(title);
      Alert.alert("Not added", e instanceof Error ? e.message : "The server didn't take it.");
    }
  }

  async function toggle(t: Task) {
    // Optimistic: the row leaves the list now, and comes back if the call fails.
    setTasks((all) => all.filter((x) => x.id !== t.id));
    try {
      await setDone(t.id, !t.doneAt);
      if (!t.doneAt) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      void load();
      Alert.alert("Not changed", e instanceof Error ? e.message : "The server didn't take it.");
    }
  }

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <View style={[s.addRow, { backgroundColor: c.card, borderColor: c.line }]}>
        <Ionicons name="add" size={22} color={c.accent} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder="Add a task"
          placeholderTextColor={c.muted}
          returnKeyType="done"
          style={[s.addInput, { color: c.ink }]}
        />
      </View>

      <View style={s.segments}>
        {(["open", "done"] as const).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[s.segment, filter === f && { backgroundColor: c.accent }]}>
            <Text style={[s.segmentText, { color: filter === f ? c.accentInk : c.muted }]}>{f === "open" ? "To do" : "Done"}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={[s.error, { color: c.danger }]}>{error}</Text> : null}

      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
        contentContainerStyle={tasks.length === 0 ? s.emptyWrap : undefined}
        ListEmptyComponent={
          loading ? undefined : <Text style={[s.empty, { color: c.muted }]}>{filter === "open" ? "Nothing to do. Nice." : "Nothing finished yet."}</Text>
        }
        renderItem={({ item }) => <Row task={item} c={c} onToggle={() => toggle(item)} />}
      />
    </View>
  );
}

function Row({ task, c, onToggle }: { task: Task; c: Palette; onToggle: () => void }) {
  const done = !!task.doneAt;
  const meta: { icon: keyof typeof Ionicons.glyphMap; text: string; late: boolean }[] = [];
  if (task.remindAt && !done) meta.push({ icon: "notifications-outline", text: whenLabel(task.remindAt), late: isPast(task.remindAt) });
  if (task.dueAt && !done) meta.push({ icon: "calendar-outline", text: `Due ${whenLabel(task.dueAt)}`, late: isPast(task.dueAt) });
  if (done && task.doneAt) meta.push({ icon: "checkmark", text: whenLabel(task.doneAt), late: false });

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
      style={[s.row, { borderBottomColor: c.line }]}
    >
      <Pressable onPress={onToggle} hitSlop={12} accessibilityLabel={done ? "Mark not done" : "Mark done"}>
        <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={26} color={done ? c.accent : c.muted} />
      </Pressable>
      <View style={s.rowBody}>
        <Text style={[s.title, { color: done ? c.muted : c.ink }, done && s.struck]} numberOfLines={2}>
          {task.title}
        </Text>
        {meta.length ? (
          <View style={s.metaRow}>
            {meta.map((m) => (
              <View key={m.icon} style={s.meta}>
                <Ionicons name={m.icon} size={13} color={m.late ? c.late : c.muted} />
                <Text style={[s.metaText, { color: m.late ? c.late : c.muted }]}>{m.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, margin: 16, marginBottom: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1 },
  addInput: { flex: 1, height: 48, fontSize: 17 },
  segments: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  segment: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  segmentText: { fontSize: 14, fontWeight: "600" },
  error: { paddingHorizontal: 16, paddingBottom: 8 },
  emptyWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: 16 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, gap: 4 },
  title: { fontSize: 17 },
  struck: { textDecorationLine: "line-through" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 13 },
});
