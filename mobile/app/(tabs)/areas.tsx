import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { AreaIcon } from "../../components/AreaIcon";
import type { Area, Entry } from "../../lib/api";
import { latestEntries, refreshAreas } from "../../lib/areas";
import { whenLabel } from "../../lib/dates";
import { onChanged } from "../../lib/events";
import { usePalette } from "../../lib/theme";

/** Every tracked area (from the repo's areas/ folder) with its latest entry. */
export default function AreasScreen() {
  const c = usePalette();
  const [areas, setAreas] = useState<Area[]>([]);
  const [latest, setLatest] = useState<Record<string, Entry>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [as, es] = await Promise.all([refreshAreas(), latestEntries()]);
      setAreas(as.filter((a) => a.kind === "log"));
      setLatest(Object.fromEntries(es.map((e) => [e.area, e])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load areas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => onChanged("entries", () => void load()), [load]);

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={areas}
      keyExtractor={(a) => a.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
      ListHeaderComponent={error ? <Text style={[s.error, { color: c.danger }]}>{error}</Text> : undefined}
      renderItem={({ item }) => {
        const e = latest[item.id];
        return (
          <Pressable onPress={() => router.push({ pathname: "/area/[id]", params: { id: item.id } })} style={[s.row, { borderBottomColor: c.line }]}>
            <AreaIcon name={item.icon ?? ""} c={c} size={24} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600" }}>{item.name}</Text>
              <Text style={{ color: c.muted, fontSize: 14 }} numberOfLines={1}>
                {e ? `${e.summary} · ${whenLabel(e.at)}` : "Nothing logged yet"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </Pressable>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  error: { padding: 16 },
});
