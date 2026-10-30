import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";

import { api, must, setAuth, type Session, type User } from "./api";
import { GOOGLE_IOS_CLIENT_ID } from "./config";

/**
 * Sign-in: native Google Sign-In gives the phone a Google ID token, the API
 * checks it (and the one-address allowlist) and answers with Bo's own token,
 * which lives in the iOS keychain via SecureStore. After that Google is out of
 * the loop until the Bo token expires or the API refuses it.
 */
const SESSION_KEY = "bo.session";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: User; token: string };

type AuthContextValue = {
  state: AuthState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const signOut = useCallback(async () => {
    setAuth(null, null);
    setState({ status: "signedOut" });
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await GoogleSignin.signOut().catch(() => undefined);
  }, []);

  const adopt = useCallback(
    (s: Session) => {
      setAuth(s.token, () => void signOut());
      setState({ status: "signedIn", user: s.user, token: s.token });
    },
    [signOut],
  );

  // Restore a saved session at launch, unless it has expired.
  useEffect(() => {
    GoogleSignin.configure({ iosClientId: GOOGLE_IOS_CLIENT_ID || undefined });
    void (async () => {
      const raw = await SecureStore.getItemAsync(SESSION_KEY);
      const saved = raw ? (JSON.parse(raw) as Session) : null;
      if (saved && new Date(saved.expiresAt).getTime() > Date.now()) adopt(saved);
      else setState({ status: "signedOut" });
    })();
  }, [adopt]);

  const signIn = useCallback(async () => {
    if (!GOOGLE_IOS_CLIENT_ID) {
      throw new Error("This build has no Google client id. Add it to app.config.ts (docs/SETUP.md step 4) and rebuild.");
    }
    const google = await GoogleSignin.signIn();
    if (!isSuccessResponse(google)) return; // cancelled — not an error
    const idToken = google.data.idToken;
    if (!idToken) throw new Error("Google did not return an ID token.");

    const r = await api.POST("/auth/google", { body: { idToken } });
    if (r.response.status === 403) {
      await GoogleSignin.signOut().catch(() => undefined);
      throw new Error(`${google.data.user.email} isn't allowed to use Bo.`);
    }
    const session = must(r);
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    adopt(session);
  }, [adopt]);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
