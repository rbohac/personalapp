import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { usePalette } from "../../lib/theme";

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
        options={{ title: "Tasks", tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={String(color)} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={String(color)} size={size} /> }}
      />
    </Tabs>
  );
}
