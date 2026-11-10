import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";

import type { Checklist } from "../../lib/api";
import { listChecklists, resetChecklist, saveChecklist, tickItem } from "../../lib/checklists";
import { usePalette } from "../../lib/theme";

/**
 * A reusable checklist — the travel packing list. Tap a row to tick it
 * while packing; Start over unticks everything for the next trip. Edit
 * turns the list into plain text, one item per line. id "packing" opens
 * the list titled Packing list (the Home button).
 */
export default function ChecklistScreen() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [list, setList] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await listChecklists();
      const found = id === "packing" ? all.find((l) => /packing/i.test(l.title)) ?? all[0] : all.find((l) => l.id === id);
      if (!found) {
        Alert.alert("No list yet", "There's no packing list to open.");
        router.back();
        return;
      }
      setList(found);
    } catch (e) {
      Alert.alert("Couldn't load it", e instanceof Error ? e.message : "");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useFocusEffect(useCallback(() => void load(), [load]));

  if (!list) {
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  async function tick(itemId: string, done: boolean) {
    if (!list) return;
    void Haptics.selectionAsync();
    // Show it straight away; the answer replaces it.
    setList({ ...list, items: list.items.map((i) => (i.id === itemId ? { ...i, done } : i)), doneCount: Number(list.doneCount) + (done ? 1 : -1) });
    try {
      setList(await tickItem(list.id, itemId, done));
    } catch (e) {
      Alert.alert("Not saved", e instanceof Error ? e.message : "");
      void load();
    }
  }

  function startOver() {
    if (!list) return;
    Alert.alert("Start over?", "Untick everything for the next trip.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Start over",
        style: "destructive",
        onPress: () => void resetChecklist(list.id).then(setList, (e) => Alert.alert("Not reset", e instanceof Error ? e.message : "")),
      },
    ]);
  }

  async function save() {
    if (!list || editing === null) return;
    setSaving(true);
    try {
      setList(await saveChecklist(list.id, list.title, editing.split("\n")));
      setEditing(null);
    } catch (e) {
      Alert.alert("Not saved", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  }

  const total = list.items.length;
  const done = Number(list.doneCount);
  const left = list.items.filter((i) => !i.done);
  const packed = list.items.filter((i) => i.done);

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={s.body}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
    >
      <Stack.Screen
        options={{
          title: list.title,
          headerRight: () =>
            editing === null ? (
              <Pressable onPress={() => setEditing(list.items.map((i) => i.text).join("\n"))} hitSlop={10}>
                <Text style={{ color: c.accent, fontSize: 17 }}>Edit</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => void save()} disabled={saving} hitSlop={10}>
                <Text style={{ color: c.accent, fontSize: 17, fontWeight: "600" }}>{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
            ),
        }}
      />

      {editing !== null ? (
        <>
          <Text style={{ color: c.muted, fontSize: 14 }}>One item per line. Ticks stay on lines you don't change.</Text>
          <TextInput
            value={editing}
            onChangeText={setEditing}
            multiline
            autoFocus
            style={[s.editor, { color: c.ink, borderColor: c.accent, backgroundColor: c.card }]}
          />
          <Pressable onPress={() => setEditing(null)} style={{ alignSelf: "center", padding: 10 }}>
            <Text style={{ color: c.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600" }}>
              {done === total && total > 0 ? "All packed ✓" : `${done} of ${total} packed`}
            </Text>
            <View style={[s.track, { backgroundColor: c.track }]}>
              <View style={[s.fill, { width: `${total ? (100 * done) / total : 0}%`, backgroundColor: c.accent }]} />
            </View>
          </View>

          <View style={[s.card, { backgroundColor: c.card, borderColor: c.line }]}>
            {[...left, ...packed].map((item, i, all) => (
              <Pressable
                key={item.id}
                onPress={() => void tick(item.id, !item.done)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                style={({ pressed }) => [s.row, { borderBottomColor: c.line, borderBottomWidth: i < all.length - 1 ? StyleSheet.hairlineWidth : 0, opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name={item.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={item.done ? c.accent : c.muted} />
                <Text style={{ color: item.done ? c.muted : c.ink, fontSize: 17, flex: 1, textDecorationLine: item.done ? "line-through" : "none" }}>{item.text}</Text>
              </Pressable>
            ))}
            {total === 0 ? <Text style={{ color: c.muted, fontSize: 15, paddingVertical: 14 }}>Empty — tap Edit to add things.</Text> : null}
          </View>

          {done > 0 ? (
            <Pressable onPress={startOver} style={[s.button, { borderColor: c.line }]}>
              <Ionicons name="refresh" size={18} color={c.ink} />
              <Text style={{ color: c.ink, fontSize: 16 }}>Start over for the next trip</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, minHeight: 52 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  button: { flexDirection: "row", gap: 8, height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  editor: { borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 17, minHeight: 280, textAlignVertical: "top", lineHeight: 26 },
});
