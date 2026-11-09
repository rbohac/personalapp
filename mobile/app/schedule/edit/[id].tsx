import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";

import type { Area, ScheduleInput } from "../../../lib/api";
import { getAreas } from "../../../lib/areas";
import { createSchedule, deleteSchedule, inputOf, listSchedules, siteLabel, updateSchedule } from "../../../lib/schedules";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
import { usePalette, type Palette } from "../../../lib/theme";
import { sectionsOf } from "../../../components/ItemChecklist";

type Section = { title: string; text: string };
/** The list as sections to edit; items before any heading form an untitled first section. */
const toSections = (items: string[]): Section[] => {
  const secs = sectionsOf(items).map((x) => ({ title: x.title ?? "", text: x.items.join("\n") }));
  return secs.length ? secs : [{ title: "", text: "" }];
};
/** Back to one list: a heading line ("# Medicines") before each titled section's items. */
const fromSections = (secs: Section[]): string[] =>
  secs.flatMap((x) => {
    const lines = x.text.split("\n").map((i) => i.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    return x.title.trim() ? [`# ${x.title.trim()}`, ...lines] : lines;
  });

const REPEATS = [
  { label: "Daily", days: 1 },
  { label: "Weekly", days: 7 },
  { label: "Every 2 weeks", days: 14 },
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIsoDay = (iso: string | null | undefined) => {
  if (!iso) return new Date();
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Add or edit a schedule. id "new" adds one. Saves the whole form. */
export default function ScheduleScreen() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const [form, setForm] = useState<ScheduleInput | null>(
    isNew ? { title: "", area: "medications", everyDays: 1, at: "08:00", match: null, nextDue: isoDay(new Date()), items: [], paused: false, rotation: [], weekdays: [], dose: "", cycle: [], doseOptions: [], fullDose: "" } : null,
  );
  const [sections, setSections] = useState<Section[]>([{ title: "", text: "" }]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [saving, setSaving] = useState(false);
  // What was loaded, to tell a look from an edit: Close until something changes.
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    getAreas().then((as) => setAreas(as.filter((a) => a.kind === "log"))).catch(() => undefined);
    if (isNew) return;
    listSchedules()
      .then((all) => {
        const s = all.find((x) => x.id === id);
        if (!s) throw new Error("That schedule is gone.");
        setForm(inputOf(s));
        setSections(toSections(s.items));
        setLoaded(JSON.stringify({ f: inputOf(s), i: toSections(s.items) }));
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

  const set = (patch: Partial<ScheduleInput>) => setForm({ ...form, ...patch });
  const every = Number(form.everyDays);
  const [h, m] = form.at.split(":").map(Number);
  // Sites this area can rotate through (shots), in the area's own order.
  const sites = areas.find((a) => a.id === form.area)?.fields?.find((f) => f.key === "site")?.options?.filter((o) => o !== "other") ?? [];
  const atDate = new Date();
  atDate.setHours(h, m, 0, 0);

  async function save() {
    if (!form) return;
    setSaving(true);
    const body: ScheduleInput = {
      ...form,
      title: form.title.trim(),
      match: form.match?.trim() || null,
      items: fromSections(sections),
      nextDue: Number(form.everyDays) > 1 ? form.nextDue ?? isoDay(new Date()) : null,
      rotation: form.rotation ?? [],
      weekdays: Number(form.everyDays) === 1 ? (form.weekdays ?? []).map(Number) : [],
      dose: (form.dose ?? "").trim(),
      cycle: Number(form.everyDays) > 1 ? (form.cycle ?? []).map(Number) : [],
      doseOptions: form.doseOptions ?? [],
      fullDose: (form.fullDose ?? "").trim(),
    };
    try {
      if (isNew) await createSchedule(body);
      else await updateSchedule(id, body);
      router.back();
    } catch (e) {
      Alert.alert("Not saved", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(`Delete "${form?.title}"?`, "Its nudges stop. Entries you've logged stay.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSchedule(id);
            router.dismissAll();
          } catch (e) {
            Alert.alert("Not deleted", e instanceof Error ? e.message : "");
          }
        },
      },
    ]);
  }

  const canSave = !saving && form.title.trim().length > 0;
  const changed = isNew || loaded !== JSON.stringify({ f: form, i: sections });
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Stack.Screen
        options={{
          title: isNew ? "New schedule" : "Edit schedule",
          headerLeft: () =>
            changed ? (
              <Pressable onPress={() => router.back()} hitSlop={10}>
                <Text style={{ color: c.muted, fontSize: 17 }}>Cancel</Text>
              </Pressable>
            ) : null,
          headerRight: () =>
            changed ? (
              <Pressable onPress={save} disabled={!canSave} hitSlop={10}>
                <Text style={{ color: c.accent, fontSize: 17, fontWeight: "600", opacity: canSave ? 1 : 0.4 }}>Save</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => router.back()} hitSlop={10}>
                <Text style={{ color: c.accent, fontSize: 17, fontWeight: "600" }}>Close</Text>
              </Pressable>
            ),
        }}
      />

      <Label c={c} text="NAME" />
      <TextInput
        value={form.title}
        onChangeText={(title) => set({ title })}
        placeholder="e.g. Fish oil"
        placeholderTextColor={c.muted}
        style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />

      <Label c={c} text="REPEATS" />
      <View style={s.chips}>
        {REPEATS.map((r) => (
          <Chip key={r.days} c={c} label={r.label} on={every === r.days} onPress={() => set({ everyDays: r.days })} />
        ))}
      </View>
      {every === 1 ? (
        <View style={s.chips}>
          {DAYS.map((d, i) => {
            const days = (form.weekdays ?? []).map(Number);
            const on = days.length === 0 || days.includes(i);
            return (
              <Pressable
                key={i}
                accessibilityLabel={DAY_NAMES[i]}
                onPress={() => {
                  const all = days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
                  const next = on ? all.filter((x) => x !== i) : [...all, i];
                  set({ weekdays: next.length === 7 ? [] : next.sort((a, b) => a - b) });
                }}
                style={[s.day, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : c.card }]}
              >
                <Text style={{ color: on ? c.accentInk : c.muted, fontSize: 15, fontWeight: "600" }}>{d}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={{ color: c.muted, fontSize: 13 }}>Counted from the last dose: a late one moves the next, and Today offers to keep the old day.</Text>
      )}

      <View style={[s.pickRow, { borderColor: c.line, backgroundColor: c.card }]}>
        <Text style={{ color: c.ink, fontSize: 16 }}>Time</Text>
        <DateTimePicker
          value={atDate}
          mode="time"
          display="compact"
          accentColor={c.accent}
          onChange={(_, d) => d && set({ at: `${pad(d.getHours())}:${pad(d.getMinutes())}` })}
        />
      </View>
      {every > 1 ? (
        <View style={[s.pickRow, { borderColor: c.line, backgroundColor: c.card }]}>
          <Text style={{ color: c.ink, fontSize: 16 }}>Next due</Text>
          <DateTimePicker
            value={fromIsoDay(form.nextDue)}
            mode="date"
            display="compact"
            accentColor={c.accent}
            onChange={(_, d) => d && set({ nextDue: isoDay(d) })}
          />
        </View>
      ) : null}

      <Label c={c} text="DOSE (OPTIONAL)" />
      <TextInput
        value={form.dose ?? ""}
        onChangeText={(dose) => set({ dose })}
        placeholder="e.g. 30 units"
        placeholderTextColor={c.muted}
        style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />
      <Text style={{ color: c.muted, fontSize: 13 }}>Logging a different dose (“tirzepatide 35 units”) updates this by itself.</Text>

      {every > 1 ? (
        <>
          <Label c={c} text="ALTERNATING GAPS (OPTIONAL)" />
          <TextInput
            defaultValue={(form.cycle ?? []).join(", ")}
            onChangeText={(t) => set({ cycle: t.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) })}
            placeholder="e.g. 4, 3 — twice a week"
            placeholderTextColor={c.muted}
            keyboardType="numbers-and-punctuation"
            style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
          />
          <Text style={{ color: c.muted, fontSize: 13 }}>Days between doses, repeating. Blank: every {every} days.</Text>

          <Label c={c} text="AMOUNTS TO PICK FROM (OPTIONAL)" />
          <TextInput
            defaultValue={(form.doseOptions ?? []).join(", ")}
            onChangeText={(t) => set({ doseOptions: t.split(",").map((x) => x.trim()).filter(Boolean) })}
            placeholder="e.g. 0.4 ml, 0.5 ml"
            placeholderTextColor={c.muted}
            style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
          />
          <Label c={c} text="FULL SHOT (OPTIONAL)" />
          <TextInput
            value={form.fullDose ?? ""}
            onChangeText={(fullDose) => set({ fullDose })}
            placeholder="e.g. 0.8 ml"
            placeholderTextColor={c.muted}
            style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
          />
          <Text style={{ color: c.muted, fontSize: 13 }}>Logging the full shot waits every {every} days for the next one instead of the next gap.</Text>
        </>
      ) : null}

      <Label c={c} text="WHAT TO TAKE" />
      <Text style={{ color: c.muted, fontSize: 13 }}>One per line. A note in brackets shows under the name: “Vyvanse (skip some days)”.</Text>
      {sections.map((sec, i) => (
        <View key={i} style={[s.section, { borderColor: c.line, backgroundColor: c.card }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              value={sec.title}
              onChangeText={(title) => setSections(sections.map((x, j) => (j === i ? { ...x, title } : x)))}
              placeholder={i === 0 ? "Section, e.g. Medicines (optional)" : "Section, e.g. Vitamins"}
              placeholderTextColor={c.muted}
              style={{ flex: 1, color: c.ink, fontSize: 16, fontWeight: "600", paddingVertical: 6 }}
            />
            {sections.length > 1 ? (
              <Pressable
                onPress={() => setSections(sections.filter((_, j) => j !== i))}
                hitSlop={10}
                accessibilityLabel={`Remove section ${sec.title || i + 1}`}
              >
                <Text style={{ color: c.danger, fontSize: 14 }}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          <TextInput
            value={sec.text}
            onChangeText={(text) => setSections(sections.map((x, j) => (j === i ? { ...x, text } : x)))}
            placeholder={i === 0 ? "Vyvanse (skip some days)\nSertraline 50 mg" : "Vitamin D 2000 IU\nFish oil"}
            placeholderTextColor={c.muted}
            multiline
            style={[s.multi, { color: c.ink, fontSize: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, paddingTop: 8 }]}
          />
        </View>
      ))}
      <Pressable onPress={() => setSections([...sections, { title: "", text: "" }])} hitSlop={6}>
        <Text style={{ color: c.accent, fontSize: 15 }}>+ Add a section</Text>
      </Pressable>

      <Label c={c} text="COUNTS AS DONE WHEN YOU LOG" />
      <View style={s.chips}>
        {areas.map((a) => (
          <Chip key={a.id} c={c} label={a.name} on={form.area === a.id} onPress={() => set({ area: a.id, rotation: [] })} />
        ))}
      </View>
      <TextInput
        value={form.match ?? ""}
        onChangeText={(match) => set({ match })}
        placeholder="…naming (optional), e.g. tirzepatide"
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />
      <Text style={{ color: c.muted, fontSize: 13 }}>
        {form.match?.trim() ? `Any ${areaName(areas, form.area)} entry naming "${form.match.trim()}".` : `Any ${areaName(areas, form.area)} entry.`}
      </Text>

      {sites.length > 0 ? (
        <>
          <Label c={c} text="ALTERNATE SITES (TAP IN ORDER)" />
          <View style={s.chips}>
            {sites.map((site) => {
              const at = (form.rotation ?? []).indexOf(site);
              return (
                <Chip
                  key={site}
                  c={c}
                  label={at >= 0 ? `${at + 1}. ${siteLabel(site)}` : siteLabel(site)}
                  on={at >= 0}
                  onPress={() => {
                    const r = form.rotation ?? [];
                    set({ rotation: at >= 0 ? r.filter((x) => x !== site) : [...r, site] });
                  }}
                />
              );
            })}
          </View>
          <Text style={{ color: c.muted, fontSize: 13 }}>
            {(form.rotation ?? []).length > 1
              ? "Each reminder names the site after the one you last logged. Saying just “left” or “right” is enough."
              : "Pick two or more to alternate."}
          </Text>
        </>
      ) : null}

      <View style={[s.pickRow, { borderColor: c.line, backgroundColor: c.card }]}>
        <Text style={{ color: c.ink, fontSize: 16 }}>Paused</Text>
        <Switch value={form.paused} onValueChange={(paused) => set({ paused })} />
      </View>

      {!isNew ? (
        <Pressable onPress={confirmDelete} style={[s.delete, { borderColor: c.line, backgroundColor: c.card }]}>
          <Text style={{ color: c.danger, fontSize: 16, fontWeight: "500" }}>Delete schedule</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const areaName = (areas: Area[], id: string) => areas.find((a) => a.id === id)?.name.toLowerCase() ?? id;

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
  multi: { minHeight: 90, textAlignVertical: "top" },
  section: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, gap: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  day: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginTop: 4 },
  delete: { marginTop: 24, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
});
