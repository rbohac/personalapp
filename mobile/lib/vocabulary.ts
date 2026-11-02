import * as SecureStore from "expo-secure-store";

import { api, must, type VocabularyInput, type VocabularyItem } from "./api";
import { changed } from "./events";

/**
 * The words Bo listens for: the person's own list, edited on the phone
 * (Settings › Voice › Words Bo listens for). The server seeds it once from
 * areas/_vocabulary.json. Handed to the speech recognizer as expected words,
 * so "tirzepatide" is heard as itself rather than "Teresa appetite".
 * Cached for the mic; every edit drops the cache.
 */
let cached: Promise<VocabularyItem[]> | null = null;

export function getVocabulary(): Promise<VocabularyItem[]> {
  cached ??= api.GET("/vocabulary").then(must).catch((e) => {
    cached = null; // a failed read is retried next time
    throw e;
  });
  return cached;
}

export function refreshVocabulary(): Promise<VocabularyItem[]> {
  cached = null;
  return getVocabulary();
}

function edited() {
  cached = null;
  changed("vocabulary");
}

export async function addWord(input: VocabularyInput): Promise<VocabularyItem> {
  const w = must(await api.POST("/vocabulary", { body: input }));
  edited();
  return w;
}

export async function updateWord(id: string, input: VocabularyInput): Promise<VocabularyItem> {
  const w = must(await api.PUT("/vocabulary/{id}", { params: { path: { id } }, body: input }));
  edited();
  return w;
}

export async function deleteWord(id: string): Promise<void> {
  must(await api.DELETE("/vocabulary/{id}", { params: { path: { id } } }));
  edited();
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
