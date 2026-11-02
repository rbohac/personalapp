import { Pressable, StyleSheet, View } from "react-native";
import { router, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { usePalette } from "../../lib/theme";

/**
 * Home · Tasks · (mic) · Areas · Settings. The mic in the middle isn't a
 * tab: it opens the capture sheet already listening, from anywhere.
 */
export default function TabsLayout() {
  const c = usePalette();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line },
        headerStyle: { backgroundColor: c.bg },
        headerTitleStyle: { color: c.ink },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={String(color)} size={size} /> }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: "Tasks", tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={String(color)} size={size} /> }}
      />
      <Tabs.Screen
        name="mic"
        options={{
          title: "",
          tabBarButton: () => (
            <View style={s.slot}>
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push({ pathname: "/capture", params: { listen: "1" } });
                }}
                onLongPress={() => router.push("/capture")}
                accessibilityLabel="Say something to log"
                style={({ pressed }) => [s.mic, { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 }]}
              >
                <Ionicons name="mic" size={30} color={c.accentInk} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="areas"
        options={{ title: "Areas", tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={String(color)} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={String(color)} size={size} /> }}
      />
    </Tabs>
  );
}

const s = StyleSheet.create({
  slot: { flex: 1, alignItems: "center" },
  mic: {
    width: 64, height: 64, borderRadius: 32, marginTop: -22, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
});
