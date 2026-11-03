import { Pressable, StyleSheet, Text, View } from "react-native";

import { num } from "../lib/ai";
import type { Palette } from "../lib/theme";

export type Bar = { key: string; value: number | string; label: string };

/**
 * A single-series bar chart drawn with plain views, so it ships over the air
 * with no native chart library. Thin bars with a 2px gap, rounded only at the
 * top and anchored to a quiet baseline; one gridline carries the scale. Tap a
 * bar to select it (the mobile stand-in for hover); the caller shows the value
 * and drills into it.
 */
export function BarChart({
  bars, c, selected, onSelect, format, height = 140, empty = "No spend yet",
}: {
  bars: Bar[];
  c: Palette;
  selected: string | null;
  onSelect: (key: string | null) => void;
  format: (v: number) => string;
  height?: number;
  /** What the scale says when every bar is zero. */
  empty?: string;
}) {
  const max = Math.max(...bars.map((b) => num(b.value)), 0);
  const ticks = [0, Math.floor((bars.length - 1) / 2), bars.length - 1];

  return (
    <View>
      <View style={s.scaleRow}>
        <Text style={[s.scale, { color: c.muted }]}>{max > 0 ? format(max) : empty}</Text>
      </View>
      <View style={[s.plot, { height, borderTopColor: c.track, borderBottomColor: c.muted }]}>
        {bars.map((b) => {
          const v = num(b.value);
          const h = max > 0 ? Math.max(v > 0 ? 3 : 0, (v / max) * (height - 4)) : 0;
          const dim = selected !== null && selected !== b.key;
          return (
            <Pressable
              key={b.key}
              onPress={() => onSelect(selected === b.key ? null : b.key)}
              style={s.col}
              accessibilityLabel={`${b.label}: ${format(v)}`}
            >
              <View style={[s.bar, { height: h, backgroundColor: c.chart, opacity: dim ? 0.35 : 1 }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={s.xRow}>
        {ticks.map((i, n) => (
          <Text key={`${i}-${n}`} style={[s.x, { color: c.muted, textAlign: n === 0 ? "left" : n === 1 ? "center" : "right" }]}>
            {bars[i]?.label ?? ""}
          </Text>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  scaleRow: { flexDirection: "row", marginBottom: 4 },
  scale: { fontSize: 12 },
  plot: { flexDirection: "row", alignItems: "flex-end", borderTopWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", borderBottomWidth: StyleSheet.hairlineWidth },
  col: { flex: 1, height: "100%", justifyContent: "flex-end", paddingHorizontal: 1 },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4, minWidth: 2 },
  xRow: { flexDirection: "row", marginTop: 6 },
  x: { flex: 1, fontSize: 12 },
});
