import * as SecureStore from "expo-secure-store";

import { api, must, type VocabularyTerm } from "./api";

/**
 * Words Bo should know (areas/_vocabulary.json, served at GET /vocabulary).
 * Handed to the speech recognizer as expected words, so "tirzepatide" is
 * heard as itself rather than "Teresa appetite". Read once per launch like
 * the areas; a failed read is retried next time.
 */
let cached: Promise<VocabularyTerm[]> | null = null;

export function getVocabulary(): Promise<VocabularyTerm[]> {
  cached ??= api.GET("/vocabulary").then(must).catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

/** The terms as the recognizer wants them. Never throws: no list just means no hints. */
export async function recognizerHints(): Promise<string[]> {
  try {
    return (await getVocabulary()).map((t) => t.term);
  } catch {
    return [];
  }
}

/**
 * Where speech is recognized. "phone" (the default) works offline and keeps
 * audio on the device; "apple" sends it to Apple's servers, which may follow
 * the expected-words list more closely. A setting so the two can be compared.
 */
export type RecognizerMode = "phone" | "apple";
const MODE_KEY = "bo.recognizer";

export async function getRecognizerMode(): Promise<RecognizerMode> {
  return (await SecureStore.getItemAsync(MODE_KEY)) === "apple" ? "apple" : "phone";
}

export async function setRecognizerMode(m: RecognizerMode): Promise<void> {
  await SecureStore.setItemAsync(MODE_KEY, m);
}
