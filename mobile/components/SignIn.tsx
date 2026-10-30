import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../lib/auth";
import { usePalette } from "../lib/theme";

export function SignIn() {
  const c = usePalette();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.bg }]}>
      <View style={s.center}>
        <Text style={[s.mark, { color: c.accent }]}>Bo</Text>
        <Text style={[s.tag, { color: c.muted }]}>Your tasks, reminders and routines.</Text>
      </View>
      <View style={s.bottom}>
        {error ? <Text style={[s.error, { color: c.danger }]}>{error}</Text> : null}
        <Pressable onPress={go} disabled={busy} style={[s.button, { backgroundColor: c.accent, opacity: busy ? 0.6 : 1 }]}>
          {busy ? <ActivityIndicator color={c.accentInk} /> : <Text style={[s.buttonText, { color: c.accentInk }]}>Continue with Google</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  mark: { fontSize: 72, fontWeight: "800", letterSpacing: -2 },
  tag: { fontSize: 16, marginTop: 8 },
  bottom: { paddingBottom: 24, gap: 12 },
  error: { textAlign: "center", fontSize: 14 },
  button: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 17, fontWeight: "600" },
});
