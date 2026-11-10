import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { Schedule } from "../lib/api";
import { shortDate } from "../lib/schedules";
import type { Palette } from "../lib/theme";

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

/**
 * Logging a shot that has a choice of amounts (testosterone: 0.4, 0.5, or
 * something else), plus Full shot for a week away. Shows what the pick does
 * to the next date before you log it: a normal dose waits the next gap (4 or
 * 3 days), a full one waits the whole week.
 */
export function DoseLogger({ c, sch, busy, onLog }: { c: Palette; sch: Schedule; busy: boolean; onLog: (dose: string) => void }) {
  const options = sch.doseOptions ?? [];
  const usual = sch.nextDose && options.includes(sch.nextDose) ? sch.nextDose : options[0] ?? null;
  const [pick, setPick] = useState<string | null>(usual);
  const [custom, setCustom] = useState("");
  const [customOn, setCustomOn] = useState(false);

  const full = sch.fullDose;
  const dose = customOn ? custom.trim() : pick;
  const isFull = !customOn && full != null && pick === full;
  const gap = isFull ? Number(sch.everyDays) : Number(sch.nextGap ?? sch.everyDays);
  const ready = !!dose && !busy;

  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
      <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600" }}>HOW MUCH?</Text>
      <View style={s.chips}>
        {options.map((o) => (
          <Chip key={o} c={c} label={o} on={!customOn && pick === o} onPress={() => { setCustomOn(false); setPick(o); }} />
        ))}
        <Chip c={c} label="Custom" on={customOn} onPress={() => setCustomOn(true)} />
      </View>
      {customOn ? (
        <TextInput
          value={custom}
          onChangeText={setCustom}
          placeholder="e.g. 0.45 ml"
          placeholderTextColor={c.muted}
          keyboardType="decimal-pad"
          autoFocus
          style={[s.input, { color: c.ink, borderColor: c.accent, backgroundColor: c.bg }]}
        />
      ) : null}
      {full ? (
        <Pressable
          onPress={() => { setCustomOn(false); setPick(isFull ? usual : full); }}
          style={[s.full, { borderColor: isFull ? c.late : c.line, backgroundColor: isFull ? c.late : c.bg }]}
        >
          <Text style={{ color: isFull ? c.accentInk : c.ink, fontSize: 16, fontWeight: "600" }}>Full shot · {full}</Text>
          <Text style={{ color: isFull ? c.accentInk : c.muted, fontSize: 13 }}>Next one a week out — for a trip</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => dose && onLog(dose)} disabled={!ready} style={[s.log, { backgroundColor: c.accent, opacity: ready ? 1 : 0.4 }]}>
        {busy ? <ActivityIndicator color={c.accentInk} /> : (
          <Text style={{ color: c.accentInk, fontSize: 16, fontWeight: "600" }}>
            {dose ? `Log ${dose}` : "Pick an amount"}
          </Text>
        )}
      </Pressable>
      {dose ? <Text style={{ color: c.muted, fontSize: 13, textAlign: "center" }}>Next one {shortDate(plusDays(gap))} · in {gap} days</Text> : null}
    </View>
  );
}

function Chip({ c, label, on, onPress }: { c: Palette; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : c.bg }]}>
      <Text style={{ color: on ? c.accentInk : c.ink, fontSize: 16, fontWeight: on ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18 },
  full: { borderWidth: 1.5, borderRadius: 12, padding: 12, gap: 2 },
  log: { height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
