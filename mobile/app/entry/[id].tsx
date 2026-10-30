import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";

import { api, must, type Area, type AreaField, type EntryInput } from "../../lib/api";
import { createEntry, deleteEntry, getArea, updateEntry } from "../../lib/areas";
import { whenLabel } from "../../lib/dates";
import { usePalette, type Palette } from "../../lib/theme";

type Values = Record<string, string | boolean | undefined>;

/**
 * Log or edit one entry by hand. The form is built from the area's fields in
 * area.json, so a new area gets a working form with no app change.
 *
 * `id` is "new" for a new entry (with `area`, and optionally `data`/`at`/`raw`
 * prefilled by a capture that needed fixing), or an entry id to edit.
 */
export default function EntryScreen() {
  const c = usePalette();
  const params = useLocalSearchParams<{ id: string; area?: string; data?: string; at?: string; raw?: string; source?: string }>();
  const isNew = params.id === "new";
  const [area, setArea] = useState<Area | null>(null);
  const [values, setValues] = useState<Values>({});
  const [at, setAt] = useState<string>(new Date().toISOString());
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        if (isNew) {
          const a = await getArea(params.area ?? "");
          if (!a) throw new Error(`No area "${params.area}".`);
          setArea(a);
          setValues(toValues(a, params.data ? (JSON.parse(params.data) as Record<string, unknown>) : {}, true));
          if (params.at) setAt(params.at);
        } else {
          const e = must(await api.GET("/entries/{id}", { params: { path: { id: params.id } } }));
          const a = await getArea(e.area);
          if (!a) throw new Error(`The area "${e.area}" no longer exists.`);
          setArea(a);
          setValues(toValues(a, e.data, false));
          setAt(e.at);
        }
      } catch (e) {
        Alert.alert("Couldn't open entry", e instanceof Error ? e.message : "");
        router.back();
      }
    })();
    // params are fixed for the life of this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!area) return;
    const data: EntryInput["data"] = {};
    for (const f of area.fields ?? []) {
      const v = values[f.key];
      if (v === undefined || v === "") continue;
      data[f.key] = f.type === "integer" || f.type === "number" ? Number(v) : v;
    }
    setSaving(true);
    try {
      const body: EntryInput = { area: area.id, at, data, source: (params.source as EntryInput["source"]) ?? "manual", raw: params.raw ?? null };
      if (isNew) await createEntry(body);
      else await updateEntry(params.id, body);
      router.back();
    } catch (e) {
      Alert.alert("Not saved", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert("Delete this entry?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteEntry(params.id);
            router.back();
          } catch (e) {
            Alert.alert("Not deleted", e instanceof Error ? e.message : "");
          }
        },
      },
    ]);
  }

  if (!area) {
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
          title: area.name,
          headerRight: () => (
            <Pressable onPress={save} disabled={saving}>
              <Text style={{ color: c.accent, fontSize: 17, fontWeight: "600", opacity: saving ? 0.4 : 1 }}>Save</Text>
            </Pressable>
          ),
        }}
      />

      {(area.fields ?? []).map((f) => (
        <Field key={f.key} f={f} c={c} value={values[f.key]} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} />
      ))}

      <View style={[s.field, { borderColor: c.line, backgroundColor: c.card }]}>
        <View style={s.head}>
          <Text style={[s.label, { color: c.muted }]}>When</Text>
          <Pressable onPress={() => setPicking((x) => !x)}>
            <Text style={{ color: c.accent, fontSize: 15 }}>{picking ? "Done" : whenLabel(at)}</Text>
          </Pressable>
        </View>
        {picking ? (
          <DateTimePicker value={new Date(at)} mode="datetime" display="inline" maximumDate={new Date()} accentColor={c.accent} onChange={(_, d) => d && setAt(d.toISOString())} />
        ) : null}
      </View>

      {params.raw ? <Text style={{ color: c.muted, fontSize: 13 }}>From: “{params.raw}”</Text> : null}

      {!isNew ? (
        <Pressable onPress={confirmDelete} style={[s.field, s.centered, { borderColor: c.line, backgroundColor: c.card }]}>
          <Text style={{ color: c.danger, fontSize: 16, fontWeight: "600" }}>Delete entry</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

/** Stored values (numbers, booleans, strings) as form state; a new entry starts from each field's default. */
function toValues(area: Area, data: Record<string, unknown>, applyDefaults: boolean): Values {
  const out: Values = {};
  for (const f of area.fields ?? []) {
    let v = data[f.key];
    if (v === undefined && applyDefaults && f.default !== undefined && f.default !== null) v = f.default;
    if (v === undefined || v === null) continue;
    out[f.key] = f.type === "boolean" ? v === true || v === "true" : String(v);
  }
  return out;
}

function Field({ f, c, value, onChange }: { f: AreaField; c: Palette; value: string | boolean | undefined; onChange: (v: string | boolean | undefined) => void }) {
  const label = `${f.label}${f.unit ? ` (${f.unit})` : ""}${f.required ? "" : " · optional"}`;
  if (f.type === "boolean") {
    return (
      <View style={[s.field, s.head, { borderColor: c.line, backgroundColor: c.card }]}>
        <Text style={{ color: c.ink, fontSize: 16 }}>{value === false ? f.falseLabel ?? "No" : f.trueLabel ?? "Yes"}</Text>
        <Switch value={value !== false} onValueChange={onChange} trackColor={{ true: c.accent }} />
      </View>
    );
  }
  return (
    <View style={[s.field, { borderColor: c.line, backgroundColor: c.card }]}>
      <Text style={[s.label, { color: c.muted }]}>{label}</Text>
      {f.type === "choice" ? (
        <View style={s.chips}>
          {(f.options ?? []).map((o) => (
            <Pressable key={o} onPress={() => onChange(value === o ? undefined : o)} style={[s.chip, { borderColor: value === o ? c.accent : c.line }]}>
              <Text style={{ color: value === o ? c.accent : c.ink, fontSize: 14 }}>{o.replace(/-/g, " ")}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <TextInput
          value={typeof value === "string" ? value : ""}
          onChangeText={onChange}
          keyboardType={f.type === "integer" ? "number-pad" : f.type === "number" ? "decimal-pad" : "default"}
          multiline={f.type === "text"}
          placeholderTextColor={c.muted}
          placeholder={f.min != null ? `${f.min}–${f.max}` : ""}
          style={[s.input, { color: c.ink }]}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 12 },
  field: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  centered: { alignItems: "center" },
  label: { fontSize: 14, fontWeight: "600" },
  input: { fontSize: 18, paddingVertical: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
});
