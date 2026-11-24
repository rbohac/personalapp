import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import type { Entry } from "../lib/api";
import { createEntry } from "../lib/areas";
import type { Palette } from "../lib/theme";

/** One tap logs these; the server fills in the caffeine from his usual amounts. */
const PRESETS = [
  { drink: "Starbucks Pike K-Cup", short: "Pike K-Cup" },
  { drink: "Advocare Spark", short: "Spark" },
  { drink: "Celsius", short: "Celsius" },
];

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase();

/**
 * Caffeine today on Home: the total, each drink with its time (newest
 * last), one-tap buttons for the usual three, and Other… for anything else
 * (Bo estimates the mg when it isn't typed).
 */
export function CaffeineCard({ c, entries, onLogged }: { c: Palette; entries: Entry[]; onLogged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const today = new Date().toDateString();
  const drinks = entries
    .filter((e) => e.area === "caffeine" && new Date(e.at).toDateString() === today)
    .sort((a, b) => a.at.localeCompare(b.at));
  const total = drinks.reduce((sum, e) => sum + (Number(e.data.mg) || 0), 0);

  async function log(drink: string) {
    setBusy(drink);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await createEntry({ area: "caffeine", data: { drink } as never, source: "manual" });
      onLogged();
    } catch (e) {
      Alert.alert("Not logged", e instanceof Error ? e.message : "");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
      <Pressable onPress={() => router.push({ pathname: "/area/[id]", params: { id: "caffeine" } })} style={s.head}>
        <Ionicons name="cafe-outline" size={20} color={c.accent} />
        <Text style={{ color: c.ink, fontSize: 16, fontWeight: "600", flex: 1 }}>Caffeine today</Text>
        <Text style={{ color: total >= 400 ? c.danger : c.ink, fontSize: 18, fontWeight: "700" }}>{total} mg</Text>
      </Pressable>
      {drinks.length ? (
        <View style={{ gap: 4 }}>
          {drinks.map((e) => (
            <Pressable key={e.id} onPress={() => router.push({ pathname: "/entry/[id]", params: { id: e.id } })} style={s.line}>
              <Text style={{ color: c.muted, fontSize: 14, width: 70 }}>{time(e.at)}</Text>
              <Text style={{ color: c.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>{String(e.data.drink ?? "")}</Text>
              <Text style={{ color: c.muted, fontSize: 14 }}>
                {e.data.mg != null ? `${String(e.data.mg)} mg` : ""}
                {String(e.data.estimate ?? "").startsWith("est.") ? " (est.)" : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={{ color: c.muted, fontSize: 14 }}>None yet today.</Text>
      )}
      <View style={s.chips}>
        {PRESETS.map((p) => (
          <Pressable key={p.drink} onPress={() => void log(p.drink)} disabled={busy !== null} style={[s.chip, { borderColor: c.accent, opacity: busy && busy !== p.drink ? 0.5 : 1 }]}>
            {busy === p.drink ? <ActivityIndicator size="small" color={c.accent} /> : <Text style={{ color: c.accent, fontSize: 15, fontWeight: "600" }}>+ {p.short}</Text>}
          </Pressable>
        ))}
        <Pressable
          onPress={() => router.push({ pathname: "/entry/[id]", params: { id: "new", area: "caffeine" } })}
          style={[s.chip, { borderColor: c.line }]}
        >
          <Text style={{ color: c.ink, fontSize: 15 }}>Other…</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minWidth: 60, alignItems: "center" },
});
