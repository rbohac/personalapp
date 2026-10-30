import { Ionicons } from "@expo/vector-icons";

import type { Palette } from "../lib/theme";

/** An area's icon from its area.json, with a fallback for a name Ionicons doesn't know. */
export function AreaIcon({ name, c, size = 20 }: { name: string; c: Palette; size?: number }) {
  const known = name in Ionicons.glyphMap;
  return <Ionicons name={(known ? name : "ellipse-outline") as keyof typeof Ionicons.glyphMap} size={size} color={c.accent} />;
}
