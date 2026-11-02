import { useState } from "react";
import { ActionSheetIOS, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import type { Palette } from "../lib/theme";

/** The quick times offered, then "Pick a time…". 6 PM only while it's ahead. */
function quickTimes(): { label: string; at: Date }[] {
  const now = Date.now();
  const six = new Date();
  six.setHours(18, 0, 0, 0);
  return [
    { label: "In 1 hour", at: new Date(now + 60 * 60e3) },
    { label: "In 2 hours", at: new Date(now + 2 * 60 * 60e3) },
    { label: "In 4 hours", at: new Date(now + 4 * 60 * 60e3) },
    ...(six.getTime() - now > 30 * 60e3 ? [{ label: "At 6 PM", at: six }] : []),
  ];
}

/**
 * Ask "when should I remind you?" — a sheet of quick times, or a time
 * picker. Call `ask(title)`; `onPick` gets the chosen moment.
 */
export function useRemindPicker(c: Palette, onPick: (at: Date) => void) {
  const [picking, setPicking] = useState<{ title: string; at: Date } | null>(null);

  function ask(title: string) {
    const times = quickTimes();
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...times.map((t) => t.label), "Pick a time…", "Cancel"], cancelButtonIndex: times.length + 1 },
      (i) => {
        if (i < times.length) onPick(times[i].at);
        else if (i === times.length) setPicking({ title, at: new Date(Date.now() + 60 * 60e3) });
      },
    );
  }

  const picker = (
    <Modal visible={picking !== null} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
      <Pressable style={s.backdrop} onPress={() => setPicking(null)}>
        <Pressable style={[s.sheet, { backgroundColor: c.card }]} onPress={() => undefined}>
          <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600" }}>{picking?.title}</Text>
          {picking ? (
            <DateTimePicker
              value={picking.at}
              mode="datetime"
              display="spinner"
              minimumDate={new Date()}
              onChange={(_, d) => d && setPicking({ ...picking, at: d })}
            />
          ) : null}
          <View style={s.row}>
            <Pressable onPress={() => setPicking(null)} style={s.btn}>
              <Text style={{ color: c.muted, fontSize: 16 }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (picking) onPick(picking.at);
                setPicking(null);
              }}
              style={s.btn}
            >
              <Text style={{ color: c.accent, fontSize: 16, fontWeight: "600" }}>Remind me</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return { ask, picker };
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { padding: 20, paddingBottom: 36, borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: 8 },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 24 },
  btn: { paddingVertical: 8 },
});
