import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { createEntry } from "../lib/areas";
import type { Palette } from "../lib/theme";

type Snack = "none" | "yes" | "carbs";
type Period = { from: Date; to: Date };

const at = (h: number, m = 0, daysAgo = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d;
};
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** Minutes from `a` to `b` on a clock, wrapping past midnight. */
const span = (a: Date, b: Date) => {
  const m = b.getHours() * 60 + b.getMinutes() - (a.getHours() * 60 + a.getMinutes());
  return m < 0 ? m + 1440 : m;
};
const NAPS: { label: string; min: number }[] = [
  { label: "No nap", min: 0 },
  { label: "20 min", min: 20 },
  { label: "45 min", min: 45 },
  { label: "1 h", min: 60 },
  { label: "2 h", min: 120 },
];

/**
 * The morning card on Home: last night in a few taps — bed and up times,
 * time up in the night, whether there was a snack (the goal is none,
 * especially carbs), CPAP and a nap. One line until opened; gone once
 * last night is logged.
 */
export function LastNight({ c, onSaved }: { c: Palette; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [bed, setBed] = useState(at(23, 0, 1));
  const [wake, setWake] = useState(() => {
    const now = new Date();
    return now.getHours() < 7 ? now : at(7);
  });
  const [periods, setPeriods] = useState<Period[]>([]);
  const [wasUp, setWasUp] = useState<boolean | null>(null);
  const [snack, setSnack] = useState<Snack | null>(null);
  const [cpapHours, setCpapHours] = useState("");
  const [cpapScore, setCpapScore] = useState("");
  const [nap, setNap] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const awakeMinutes = periods.reduce((sum, p) => sum + span(p.from, p.to), 0);

  async function save() {
    setSaving(true);
    try {
      const data: Record<string, unknown> = { bed: hhmm(bed), wake: hhmm(wake) };
      if (wasUp === false) data.awake_minutes = 0;
      if (wasUp && periods.length) {
        data.awake = periods.map((p) => `${hhmm(p.from)}–${hhmm(p.to)}`).join(", ");
        data.awake_minutes = awakeMinutes;
      }
      if (snack) data.snack = snack;
      if (cpapHours.trim()) data.cpap_hours = Number(cpapHours.replace(",", "."));
      if (cpapScore.trim()) data.cpap_score = Number(cpapScore);
      if (nap !== null) data.nap_minutes = nap;
      await createEntry({ area: "sleep", data: data as never, source: "manual" });
      onSaved();
    } catch (e) {
      Alert.alert("Not saved", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={[s.card, s.row, { backgroundColor: c.card, borderColor: c.line }]}>
        <Ionicons name="moon-outline" size={20} color={c.accent} />
        <Text style={{ color: c.ink, fontSize: 16, flex: 1 }}>How was last night?</Text>
        <Text style={{ color: c.accent, fontSize: 15, fontWeight: "600" }}>Log it</Text>
      </Pressable>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.line, gap: 14 }]}>
      <View style={s.row}>
        <Ionicons name="moon-outline" size={20} color={c.accent} />
        <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600", flex: 1 }}>Last night</Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="chevron-up" size={20} color={c.muted} />
        </Pressable>
      </View>

      <View style={s.times}>
        <Time c={c} label="Bed" value={bed} onChange={setBed} />
        <Time c={c} label="Up" value={wake} onChange={setWake} />
      </View>

      <Group c={c} label="Up during the night?">
        <Chip c={c} label="No" on={wasUp === false} onPress={() => { setWasUp(false); setPeriods([]); }} />
        <Chip
          c={c}
          label={wasUp && periods.length ? `Yes · ${Math.round(awakeMinutes / 6) / 10} h` : "Yes"}
          on={wasUp === true}
          onPress={() => {
            setWasUp(true);
            if (periods.length === 0) setPeriods([{ from: at(1), to: at(2) }]);
          }}
        />
      </Group>
      {wasUp
        ? periods.map((p, i) => (
            <View key={i} style={s.period}>
              <Time c={c} label="From" value={p.from} onChange={(d) => setPeriods(periods.map((q, j) => (j === i ? { ...q, from: d } : q)))} />
              <Time c={c} label="To" value={p.to} onChange={(d) => setPeriods(periods.map((q, j) => (j === i ? { ...q, to: d } : q)))} />
              <Pressable onPress={() => setPeriods(periods.filter((_, j) => j !== i))} hitSlop={10} accessibilityLabel="Remove this time">
                <Ionicons name="close-circle-outline" size={22} color={c.muted} />
              </Pressable>
            </View>
          ))
        : null}
      {wasUp ? (
        <Pressable onPress={() => setPeriods([...periods, { from: at(3), to: at(3, 30) }])}>
          <Text style={{ color: c.accent, fontSize: 15 }}>+ Another time up</Text>
        </Pressable>
      ) : null}

      <Group c={c} label="Snacked overnight?">
        <Chip c={c} label="No" on={snack === "none"} onPress={() => setSnack("none")} />
        <Chip c={c} label="Yes" on={snack === "yes"} onPress={() => setSnack("yes")} />
        <Chip c={c} label="Yes, carbs" on={snack === "carbs"} warn onPress={() => setSnack("carbs")} />
      </Group>

      <View style={s.times}>
        <Num c={c} label="CPAP hours" value={cpapHours} onChange={setCpapHours} decimal />
        <Num c={c} label="CPAP score" value={cpapScore} onChange={setCpapScore} />
      </View>

      <Group c={c} label="Nap yesterday?">
        {NAPS.map((n) => (
          <Chip key={n.min} c={c} label={n.label} on={nap === n.min} onPress={() => setNap(n.min)} />
        ))}
      </Group>

      <Pressable onPress={() => void save()} disabled={saving} style={[s.save, { backgroundColor: c.accent, opacity: saving ? 0.5 : 1 }]}>
        {saving ? <ActivityIndicator color={c.accentInk} /> : <Text style={{ color: c.accentInk, fontSize: 16, fontWeight: "600" }}>Save last night</Text>}
      </Pressable>
    </View>
  );
}

function Time({ c, label, value, onChange }: { c: Palette; label: string; value: Date; onChange: (d: Date) => void }) {
  return (
    <View style={[s.box, { borderColor: c.line, backgroundColor: c.bg }]}>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
      <DateTimePicker value={value} mode="time" display="compact" accentColor={c.accent} onChange={(_, d) => d && onChange(d)} />
    </View>
  );
}

function Num({ c, label, value, onChange, decimal }: { c: Palette; label: string; value: string; onChange: (v: string) => void; decimal?: boolean }) {
  return (
    <View style={[s.box, { borderColor: c.line, backgroundColor: c.bg }]}>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={decimal ? "decimal-pad" : "number-pad"}
        placeholder="—"
        placeholderTextColor={c.muted}
        accessibilityLabel={label}
        style={{ color: c.ink, fontSize: 20, fontWeight: "600", paddingVertical: 2 }}
      />
    </View>
  );
}

function Group({ c, label, children }: { c: Palette; label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
      <View style={s.chips}>{children}</View>
    </View>
  );
}

function Chip({ c, label, on, warn, onPress }: { c: Palette; label: string; on: boolean; warn?: boolean; onPress: () => void }) {
  const tone = warn ? c.late : c.accent;
  return (
    <Pressable onPress={onPress} style={[s.chip, { borderColor: on ? tone : c.line, backgroundColor: on ? tone : c.card }]}>
      <Text style={{ color: on ? c.accentInk : c.ink, fontSize: 15, fontWeight: on ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  times: { flexDirection: "row", gap: 10 },
  box: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, gap: 4, alignItems: "flex-start" },
  period: { flexDirection: "row", gap: 10, alignItems: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  save: { height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
