import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { VocabularyItem } from "../../lib/api";
import { onChanged } from "../../lib/events";
import { usePalette } from "../../lib/theme";
import { addWord, refreshVocabulary } from "../../lib/vocabulary";

/** The words Bo listens for: add one at the top, tap one to edit or delete it. */
export default function VocabularyScreen() {
  const c = usePalette();
  const [words, setWords] = useState<VocabularyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWords(await refreshVocabulary());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the list.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onChanged("vocabulary", () => void load()), [load]);

  async function add() {
    const term = draft.trim();
    if (!term) return;
    setAdding(true);
    try {
      await addWord({ term });
      setDraft("");
    } catch (e) {
      Alert.alert("Not added", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={words}
      keyExtractor={(w) => w.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
      ListHeaderComponent={
        <View style={s.header}>
          <View style={[s.addRow, { backgroundColor: c.card, borderColor: c.line }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a word, e.g. semaglutide"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => void add()}
              style={[s.input, { color: c.ink }]}
            />
            {adding ? (
              <ActivityIndicator color={c.accent} />
            ) : (
              <Pressable onPress={() => void add()} disabled={!draft.trim()} hitSlop={8}>
                <Text style={{ color: c.accent, fontSize: 16, fontWeight: "600", opacity: draft.trim() ? 1 : 0.4 }}>Add</Text>
              </Pressable>
            )}
          </View>
          {error ? <Text style={{ color: c.danger, fontSize: 14 }}>{error}</Text> : null}
          <Text style={{ color: c.muted, fontSize: 13 }}>
            {words.length} {words.length === 1 ? "word" : "words"} · new words apply the next time you tap the mic
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: "/vocabulary/[id]", params: { id: item.id } })} style={[s.row, { borderBottomColor: c.line }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.ink, fontSize: 17 }}>{item.term}</Text>
            {item.heard.length ? (
              <Text style={{ color: c.muted, fontSize: 14 }} numberOfLines={1}>
                Misheard as: {item.heard.join(", ")}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.muted} />
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  header: { padding: 16, gap: 8 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
});
