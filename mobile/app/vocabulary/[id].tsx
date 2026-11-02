import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";

import { usePalette } from "../../lib/theme";
import { deleteWord, getVocabulary, updateWord } from "../../lib/vocabulary";

/** Edit one word: how it's spelled, and what it gets misheard as (one per line). */
export default function WordScreen() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState(false);
  const [term, setTerm] = useState("");
  const [heard, setHeard] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getVocabulary()
      .then((ws) => {
        const w = ws.find((x) => x.id === id);
        if (!w) throw new Error("That word is no longer on the list.");
        setTerm(w.term);
        setHeard(w.heard.join("\n"));
        setLoaded(true);
      })
      .catch((e) => {
        Alert.alert("Couldn't open word", e instanceof Error ? e.message : "");
        router.back();
      });
  }, [id]);

  async function save() {
    setSaving(true);
    try {
      await updateWord(id, { term: term.trim(), heard: heard.split(/[\n,]/).map((h) => h.trim()).filter(Boolean) });
      router.back();
    } catch (e) {
      Alert.alert("Not saved", e instanceof Error ? e.message : "The server didn't take it.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(`Remove "${term}"?`, "Bo stops listening for it. You can add it back any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteWord(id);
            router.back();
          } catch (e) {
            Alert.alert("Not removed", e instanceof Error ? e.message : "");
          }
        },
      },
    ]);
  }

  if (!loaded) {
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  const canSave = !saving && term.trim().length > 0;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={save} disabled={!canSave}>
              <Text style={{ color: c.accent, fontSize: 17, fontWeight: "600", opacity: canSave ? 1 : 0.4 }}>Save</Text>
            </Pressable>
          ),
        }}
      />
      <Text style={[s.label, { color: c.muted }]}>WORD</Text>
      <TextInput
        value={term}
        onChangeText={setTerm}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.field, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />
      <Text style={[s.label, { color: c.muted }]}>MISHEARD AS (ONE PER LINE)</Text>
      <TextInput
        value={heard}
        onChangeText={setHeard}
        placeholder="e.g. teresa appetite"
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        style={[s.field, s.multi, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
      />
      <Pressable onPress={confirmDelete} style={[s.delete, { borderColor: c.line, backgroundColor: c.card }]}>
        <Text style={{ color: c.danger, fontSize: 16, fontWeight: "500" }}>Remove word</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: "600", paddingHorizontal: 4, marginTop: 8 },
  field: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  multi: { minHeight: 100, textAlignVertical: "top" },
  delete: { marginTop: 24, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
});
