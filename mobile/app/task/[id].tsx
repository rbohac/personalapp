import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";

import type { Task } from "../../lib/api";
import { PRESET_LABEL, presetTime, whenLabel, type ReminderPreset } from "../../lib/dates";
import { tasksChanged } from "../../lib/events";
import { deleteTask, getTask, setDone, updateTask } from "../../lib/tasks";
import { usePalette, type Palette } from "../../lib/theme";

const PRESETS = Object.keys(PRESET_LABEL) as ReminderPreset[];

/** Edit one task: words, a reminder, a due date, done, delete. Saves the whole form. */
export default function TaskScreen() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getTask(id)
      .then((t) => {
        setTask(t);
        setTitle(t.title);
        setNotes(t.notes ?? "");
        setRemindAt(t.remindAt);
        setDueAt(t.dueAt);
      })
      .catch((e) => {
        Alert.alert("Couldn't open task", e instanceof Error ? e.message : "");
        router.back();
      });
  }, [id]);

  async function save() {
    setSaving(true);
    try {
      await updateTask(id, { title: title.trim(), notes: notes.trim() || null, remindAt, dueAt });
      tasksChanged();
      router.back();
    } catch (e) {
      Alert.alert("Not saved", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone() {
    if (!task) return;
    try {
      setTask(await setDone(id, !task.doneAt));
      tasksChanged();
    } catch (e) {
      Alert.alert("Not changed", e instanceof Error ? e.message : "");
    }
  }

  function confirmDelete() {
    Alert.alert("Delete this task?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteTask(id);
            tasksChanged();
            router.back();
          } catch (e) {
            Alert.alert("Not deleted", e instanceof Error ? e.message : "");
          }
        },
      },
    ]);
  }

  if (!task) {
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={save} disabled={saving || !title.trim()}>
              <Text style={{ color: c.accent, fontSize: 17, fontWeight: "600", opacity: saving || !title.trim() ? 0.4 : 1 }}>Save</Text>
            </Pressable>
          ),
        }}
      />

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Title"
        placeholderTextColor={c.muted}
        style={[s.title, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
        multiline
      />
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes"
        placeholderTextColor={c.muted}
        style={[s.notes, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
        multiline
      />

      <WhenPicker
        c={c}
        label="Remind me"
        value={remindAt}
        onChange={setRemindAt}
        presets={PRESETS.map((p) => ({ label: PRESET_LABEL[p], at: () => presetTime(p) }))}
      />
      <WhenPicker
        c={c}
        label="Due"
        value={dueAt}
        onChange={setDueAt}
        presets={[
          { label: "Today", at: () => endOfDay(0) },
          { label: "Tomorrow", at: () => endOfDay(1) },
          { label: "In a week", at: () => endOfDay(7) },
        ]}
      />

      <Pressable onPress={toggleDone} style={[s.action, { borderColor: c.line, backgroundColor: c.card }]}>
        <Text style={[s.actionText, { color: c.ink }]}>{task.doneAt ? "Mark not done" : "Mark done"}</Text>
      </Pressable>
      <Pressable onPress={confirmDelete} style={[s.action, { borderColor: c.line, backgroundColor: c.card }]}>
        <Text style={[s.actionText, { color: c.danger }]}>Delete task</Text>
      </Pressable>
    </ScrollView>
  );
}

/** 5 PM on a day relative to today — a due date is about the day, not the minute. */
function endOfDay(daysAhead: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(17, 0, 0, 0);
  return d;
}

function WhenPicker({
  c, label, value, onChange, presets,
}: {
  c: Palette;
  label: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  presets: { label: string; at: () => Date }[];
}) {
  const [picking, setPicking] = useState(false);
  return (
    <View style={[s.section, { borderColor: c.line, backgroundColor: c.card }]}>
      <View style={s.sectionHead}>
        <Text style={[s.sectionLabel, { color: c.muted }]}>{label}</Text>
        <Text style={[s.sectionValue, { color: value ? c.ink : c.muted }]}>{value ? whenLabel(value) : "None"}</Text>
      </View>
      <View style={s.chips}>
        {presets.map((p) => (
          <Chip key={p.label} c={c} label={p.label} onPress={() => onChange(p.at().toISOString())} />
        ))}
        <Chip c={c} label={picking ? "Done" : "Pick…"} onPress={() => setPicking((x) => !x)} />
        {value ? <Chip c={c} label="Clear" onPress={() => onChange(null)} /> : null}
      </View>
      {picking ? (
        <DateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="datetime"
          display="inline"
          accentColor={c.accent}
          onChange={(_, d) => d && onChange(d.toISOString())}
        />
      ) : null}
    </View>
  );
}

function Chip({ c, label, onPress }: { c: Palette; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, { borderColor: c.line }]}>
      <Text style={{ color: c.ink, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "600", padding: 12, borderRadius: 12, borderWidth: 1 },
  notes: { fontSize: 16, minHeight: 90, padding: 12, borderRadius: 12, borderWidth: 1, textAlignVertical: "top" },
  section: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 10 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between" },
  sectionLabel: { fontSize: 14, fontWeight: "600" },
  sectionValue: { fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  action: { padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  actionText: { fontSize: 16, fontWeight: "600" },
});
