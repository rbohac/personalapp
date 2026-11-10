import { ActionSheetIOS, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { ItemMark, Schedule } from "../lib/api";
import { confirmSkip, itemName, type ItemState } from "../lib/schedules";
import type { Palette } from "../lib/theme";

/** A schedule's list split into its sections: lines starting "# " are headings. */
export function sectionsOf(items: string[]): { title: string | null; items: string[] }[] {
  const out: { title: string | null; items: string[] }[] = [];
  for (const line of items) {
    if (line.startsWith("#")) out.push({ title: line.replace(/^#+\s*/, ""), items: [] });
    else {
      if (out.length === 0) out.push({ title: null, items: [] });
      out[out.length - 1].items.push(line);
    }
  }
  return out.filter((s) => s.items.length > 0 || s.title);
}

/**
 * A daily list as a checklist: one item per row, grouped by its sections.
 * Tap a row to tick it (again to untick); hold for skip today or remind me
 * later.
 */
export function ItemChecklist({
  c, sch, onSet, onAskWhen,
}: {
  c: Palette;
  sch: Schedule;
  onSet: (item: string, state: ItemState, reason?: string) => void;
  onAskWhen: (items: string[]) => void;
}) {
  const marks = new Map(sch.today.map((m) => [m.item, m]));

  function tap(m: ItemMark) {
    if (m.state === "taken") {
      if (m.byEntry) Alert.alert("Logged already", `An entry you logged today names ${itemName(m.item)}. Delete it on the Medications screen to untick.`);
      else onSet(m.item, "open");
    } else onSet(m.item, "taken");
  }

  function hold(m: ItemMark) {
    const options = ["Taken", "Skip today", "Remind me later…", ...(m.state !== "open" && !m.byEntry ? ["Not yet (untick)"] : []), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions({ title: m.item, options, cancelButtonIndex: options.length - 1 }, (i) => {
      const pick = options[i];
      if (pick === "Taken") onSet(m.item, "taken");
      else if (pick === "Skip today") confirmSkip(itemName(m.item), (reason) => onSet(m.item, "skipped", reason));
      else if (pick === "Remind me later…") onAskWhen([m.item]);
      else if (pick === "Not yet (untick)") onSet(m.item, "open");
    });
  }

  return (
    <View style={{ gap: 14 }}>
      {sectionsOf(sch.items).map((sec, si) => (
        <View key={si} style={{ gap: 0 }}>
          {sec.title ? <Text style={[s.heading, { color: c.muted }]}>{sec.title.toUpperCase()}</Text> : null}
          <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
            {sec.items.map((item, i) => {
              const m = marks.get(item) ?? { item, state: "open", remindAt: null, byEntry: false };
              const name = itemName(item);
              const note = item.length > name.length ? item.slice(name.length).trim().replace(/^\(|\)$/g, "") : "";
              const icon =
                m.state === "taken" ? "checkmark-circle" : m.state === "skipped" ? "remove-circle-outline" : m.state === "later" ? "time-outline" : "ellipse-outline";
              const tone = m.state === "taken" ? c.accent : m.state === "later" ? c.late : c.muted;
              return (
                <Pressable
                  key={item}
                  onPress={() => tap(m)}
                  onLongPress={() => hold(m)}
                  delayLongPress={350}
                  style={({ pressed }) => [s.row, { borderBottomColor: c.line, borderBottomWidth: i < sec.items.length - 1 ? StyleSheet.hairlineWidth : 0, opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: m.state === "taken" }}
                >
                  <Ionicons name={icon} size={26} color={tone} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={{ color: m.state === "skipped" ? c.muted : c.ink, fontSize: 17, textDecorationLine: m.state === "skipped" ? "line-through" : "none" }}>{name}</Text>
                    {note ? <Text style={{ color: c.muted, fontSize: 13 }}>{note}</Text> : null}
                  </View>
                  <Text style={{ color: tone, fontSize: 13 }}>
                    {m.state === "taken" ? (m.byEntry ? "Logged" : "Taken")
                      : m.state === "skipped" ? "Skipped"
                      : m.state === "later" && m.remindAt ? new Date(m.remindAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                      : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  heading: { fontSize: 12, fontWeight: "600", paddingHorizontal: 4, paddingBottom: 6 },
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, minHeight: 52 },
});
