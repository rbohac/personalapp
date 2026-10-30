import Constants from "expo-constants";

/** Where the API lives. Set per build profile in eas.json, or in .env locally. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://api.bohac.dev").replace(/\/$/, "");

/** The iOS OAuth client id, from app.config.ts. Empty until docs/SETUP.md step 4. */
export const GOOGLE_IOS_CLIENT_ID = (Constants.expoConfig?.extra as { googleIosClientId?: string } | undefined)?.googleIosClientId ?? "";

/** The EAS project id Expo's push service needs. Empty until `eas init`. */
export const EAS_PROJECT_ID =
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? "";
