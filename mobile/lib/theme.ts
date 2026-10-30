import { useColorScheme } from "react-native";

/** Bo's palette. Coral is the one brand colour; everything else is neutral. */
const light = {
  bg: "#FAFAF9",
  card: "#FFFFFF",
  ink: "#1C1917",
  muted: "#78716C",
  line: "#E7E5E4",
  accent: "#FF6B4A",
  accentInk: "#FFFFFF",
  danger: "#DC2626",
  late: "#B45309",
};

const dark: typeof light = {
  bg: "#0C0A09",
  card: "#1C1917",
  ink: "#FAFAF9",
  muted: "#A8A29E",
  line: "#292524",
  accent: "#FF7A5C",
  accentInk: "#0C0A09",
  danger: "#F87171",
  late: "#FBBF24",
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
