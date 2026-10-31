import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { Area, Entry } from "../../lib/api";
import { getArea, listEntries } from "../../lib/areas";
import { whenLabel } from "../../lib/dates";
import { onChanged } from "../../lib/events";
import { usePalette } from "../../lib/theme";

/** One area's history, newest first, with + to log by hand. */
export default function AreaScreen() {
  const c = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [area, setArea] = useState<Area | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setArea((await getArea(id)) ?? null);
      setEntries(await listEntries(id, 200));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load entries.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onChanged("entries", () => void load()), [load]);

  return (
    <>
      <Stack.Screen
        options={{
          title: area?.name ?? "",
          headerRight: () => (
            <Pressable onPress={() => router.push({ pathname: "/entry/[id]", params: { id: "new", area: id } })} hitSlop={12} accessibilityLabel="Log by hand">
              <Ionicons name="add" size={28} color={c.accent} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        style={{ backgroundColor: c.bg }}
        data={entries}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
        contentContainerStyle={entries.length === 0 ? s.emptyWrap : undefined}
        ListHeaderComponent={error ? <Text style={[s.pad, { color: c.danger }]}>{error}</Text> : undefined}
        ListEmptyComponent={loading ? undefined : <Text style={{ color: c.muted, fontSize: 16 }}>Nothing logged yet.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: "/entry/[id]", params: { id: item.id } })} style={[s.row, { borderBottomColor: c.line }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.ink, fontSize: 17 }}>{item.summary}</Text>
              {typeof item.data.notes === "string" ? <Text style={{ color: c.muted, fontSize: 14 }} numberOfLines={1}>{item.data.notes}</Text> : null}
            </View>
            <Text style={{ color: c.muted, fontSize: 13 }}>{whenLabel(item.at)}</Text>
          </Pressable>
        )}
      />
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  emptyWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  pad: { padding: 16 },
});
