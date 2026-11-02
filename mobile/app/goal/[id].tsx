import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";

import type { Area, GoalInput } from "../../lib/api";
import { getAreas } from "../../lib/areas";
import { createGoal, deleteGoal, goalInputOf, listGoals, updateGoal } from "../../lib/goals";
import { usePalette, type Palette } from "../../lib/theme";

/** Add or edit a weekly goal. id "new" adds one. Saves the whole form. */
export default function GoalScreen() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const [form, setForm] = useState<GoalInput | null>(isNew ? { title: "", area: "walks", measure: "days", target: 3, paused: false, period: "week" } : null);
  const [targetText, setTargetText] = useState(isNew ? "3" : "");
  const [excludeText, setExcludeText] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAreas().then((as) => setAreas(as.filter((a) => a.kind === "log"))).catch(() => undefined);
    if (isNew) return;
    listGoals()
      .then((all) => {
        const g = all.find((x) => x.id === id);
        if (!g) throw new Error("That goal is gone.");
        setForm(goalInputOf(g));
        setTargetText(String(Number(g.target)));
        setExcludeText(g.excludeValues.join(", "));
      })
      .catch((e) => {
        Alert.alert("Couldn't open it", e instanceof Error ? e.message : "");
        router.back();
      });
  }, [id, isNew]);

  if (!form) {
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  const set = (patch: Partial<GoalInput>) => setForm({ ...form, ...patch });
  const area = areas.find((a) => a.id === form.area);
  const numberFields = (area?.fields ?? []).filter((f) => f.type === "integer" || f.type === "number");
  const unit = form.measure === "days" ? "days" : numberFields.find((f) => f.key === form.field)?.unit ?? "";
  // Only areas with a "type" can leave some kinds out (lifting = workouts that aren't a run).
  const canExclude = (area?.fields ?? []).some((f) => f.key === "type");

  async function save() {
    if (!form) return;
    const target = Number(targetText.replace(",", "."));
    if (!(target > 0)) return Alert.alert("Pick a target", "A number more than zero.");
    setSaving(true);
    const body: GoalInput = {
      ...form,
      title: form.title.trim(),
      target,
      field: form.measure === "total" ? form.field ?? numberFields[0]?.key ?? null : null,
      excludeField: canExclude && excludeText.trim() ? "type" : null,
      excludeValues: canExclude ? excludeText.split(",").map((v) => v.trim()).filter(Boolean) : [],
    };
    try {
      if (isNew) await createGoal(body);
      else await updateGoal(id, body);
      router.back();
    } catch (e) {
      Alert.alert("Not saved", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(`Delete "${form?.title}"?`, "Your logged entries stay.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteGoal(id);
            router.back();
          } catch (e) {
            Alert.alert("Not deleted", e instanceof Error ? e.message : "");
          }
        },
      },
    ]);
  }

  const canSave = !saving && form.title.trim().length > 0;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Stack.Screen
        options={{
          title: isNew ? "New goal" : "Goal",
          headerRight: () => (
            <Pressable onPress={save} disabled={!canSave}>
              <Text style={{ color: c.accent, fontSize: 17, fontWeight: "600", opacity: canSave ? 1 : 0.4 }}>Save</Text>
            </Pressable>
          ),
        }}
      />

      <Label c={c} text="NAME" />
      <TextInput
        value={form.title}
        onChangeText={(title) => set({ title })}
        placeholder="e.g. Walk days"
        placeholderTextColor={c.muted}
        style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />

      <Label c={c} text="COUNT" />
      <View style={s.chips}>
        {areas.map((a) => (
          <Chip key={a.id} c={c} label={a.name} on={form.area === a.id} onPress={() => set({ area: a.id, field: null })} />
        ))}
      </View>
      <View style={s.chips}>
        {form.period !== "day" ? (
          <Chip c={c} label="Days with one" on={form.measure === "days"} onPress={() => set({ measure: "days" })} />
        ) : null}
        {numberFields.map((f) => (
          <Chip
            key={f.key}
            c={c}
            label={`Total ${f.label.toLowerCase()}`}
            on={form.measure === "total" && form.field === f.key}
            onPress={() => set({ measure: "total", field: f.key })}
          />
        ))}
      </View>

      <Label c={c} text="HOW OFTEN" />
      <View style={s.chips}>
        <Chip c={c} label="Each week" on={form.period !== "day"} onPress={() => set({ period: "week" })} />
        <Chip
          c={c}
          label="Each day"
          on={form.period === "day"}
          onPress={() => set({ period: "day", measure: form.measure === "days" ? "total" : form.measure, field: form.field ?? numberFields[0]?.key ?? null })}
        />
      </View>
      <Label c={c} text={form.period === "day" ? "EACH DAY, AT LEAST" : "EACH WEEK, AT LEAST"} />
      <View style={[s.pickRow, { borderColor: c.line, backgroundColor: c.card }]}>
        <TextInput
          value={targetText}
          onChangeText={setTargetText}
          keyboardType="decimal-pad"
          style={{ color: c.ink, fontSize: 18, flex: 1, paddingVertical: 6 }}
        />
        <Text style={{ color: c.muted, fontSize: 16 }}>{unit}</Text>
      </View>

      {canExclude ? (
        <>
          <Label c={c} text="DON'T COUNT TYPES CONTAINING (COMMAS)" />
          <TextInput
            value={excludeText}
            onChangeText={setExcludeText}
            placeholder="e.g. run, walk"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
          />
        </>
      ) : null}

      <View style={[s.pickRow, { borderColor: c.line, backgroundColor: c.card, marginTop: 12 }]}>
        <Text style={{ color: c.ink, fontSize: 16 }}>Paused</Text>
        <Switch value={form.paused} onValueChange={(paused) => set({ paused })} />
      </View>

      {!isNew ? (
        <Pressable onPress={confirmDelete} style={[s.delete, { borderColor: c.line, backgroundColor: c.card }]}>
          <Text style={{ color: c.danger, fontSize: 16, fontWeight: "500" }}>Delete goal</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Label({ c, text }: { c: Palette; text: string }) {
  return <Text style={[s.label, { color: c.muted }]}>{text}</Text>;
}

function Chip({ c, label, on, onPress }: { c: Palette; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, { borderColor: on ? c.accent : c.line }]}>
      <Text style={{ color: on ? c.accent : c.ink, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontSize: 12, fontWeight: "600", paddingHorizontal: 4, marginTop: 10 },
  field: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  delete: { marginTop: 24, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
});
