import type { ExpoConfig } from "expo/config";

/**
 * Bo's app config. TypeScript rather than app.json so two values can be
 * derived instead of typed twice. Neither is a secret — both end up inside
 * the shipped app — so they are committed here once known (docs/SETUP.md):
 *
 *  - GOOGLE_IOS_CLIENT_ID — the iOS OAuth client from Google Cloud. Google
 *    Sign-In also needs its REVERSED form registered as a URL scheme, derived
 *    below so the two can never disagree. The app reads the same value at
 *    runtime from `extra.googleIosClientId`.
 *  - EAS_PROJECT_ID — printed by `eas init` under the personal Expo account.
 *
 * Either can be overridden from the environment for experiments.
 */
const GOOGLE_IOS_CLIENT_ID = "646118810214-u298ds3die86438sh1kvvsit01hq1scu.apps.googleusercontent.com";
const EAS_PROJECT_ID = "00f9b088-d002-4ca0-9724-069d4f7ad9df";

const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || GOOGLE_IOS_CLIENT_ID;
const reversedClientId = googleIosClientId.split(".").reverse().join(".");
const projectId = process.env.EAS_PROJECT_ID || EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: "Bo",
  slug: "bo",
  // The personal Expo account, separate from Spearfish's.
  owner: "rbohac-personal",
  version: "0.1.0",
  scheme: "bo",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  runtimeVersion: { policy: "fingerprint" },
  ...(projectId
    ? { updates: { url: `https://u.expo.dev/${projectId}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 } }
    : {}),
  ios: {
    bundleIdentifier: "dev.bohac.bo",
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // Apple rejects a build whose libraries reference these APIs without a
      // purpose string, even when Bo never calls them (ITMS-90683 on 0.1.0).
      NSPhotoLibraryUsageDescription: "Bo only opens your photos when you choose one to attach.",
      NSCameraUsageDescription: "Bo only uses the camera when you choose to take a photo to attach.",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-notifications", { color: "#FF6B4A" }],
    [
      "expo-speech-recognition",
      {
        microphonePermission: "Bo listens only after you tap the mic, to write down what you say.",
        speechRecognitionPermission: "What you say is turned into text on this phone so Bo can log it.",
      },
    ],
    ...(googleIosClientId
      ? [["@react-native-google-signin/google-signin", { iosUrlScheme: reversedClientId }] as [string, object]]
      : []),
  ],
  experiments: { typedRoutes: true },
  extra: {
    googleIosClientId,
    eas: projectId ? { projectId } : {},
  },
};

export default config;
