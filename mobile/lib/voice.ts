import { useCallback, useRef, useState } from "react";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";

import { getRecognizerMode, recognizerHints } from "./vocabulary";

/** Stop after this long with no new words: long enough for a pause to think. */
export const SILENCE_MS = 3000;
/** Give up if nothing at all is heard for this long after starting. */
const NOTHING_HEARD_MS = 8000;
/** iOS caps a recognition session at about a minute; stop just before. */
const MAX_MS = 55000;

/**
 * Speech to text for the capture box, on the phone (on-device recognition
 * where iOS supports it). `onText` receives the whole transcript so far,
 * replacing rather than appending, because interim results revise earlier
 * words as more is heard.
 *
 * Recognition is continuous, so a pause to think doesn't end it; Bo stops it
 * itself after SILENCE_MS with no new words (or on a tap). iOS 18 may start
 * a fresh transcript after a pause, so words already settled are kept and the
 * new ones added after them.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Speech events are global; only react to a session this hook started.
  const mine = useRef(false);
  const settled = useRef(""); // text from finished segments of this session
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cap = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (quiet.current) clearTimeout(quiet.current);
    if (cap.current) clearTimeout(cap.current);
    quiet.current = cap.current = null;
  };
  const stopSoon = (ms: number) => {
    if (quiet.current) clearTimeout(quiet.current);
    quiet.current = setTimeout(() => {
      if (mine.current) ExpoSpeechRecognitionModule.stop();
    }, ms);
  };

  useSpeechRecognitionEvent("start", () => {
    if (mine.current) setListening(true);
  });
  useSpeechRecognitionEvent("end", () => {
    if (!mine.current) return;
    mine.current = false;
    clearTimers();
    setListening(false);
  });
  useSpeechRecognitionEvent("result", (e) => {
    if (!mine.current) return;
    const text = e.results[0]?.transcript?.trim();
    if (!text) return;
    // Cumulative transcript (it repeats what's settled), or a fresh segment after a pause.
    const whole = !settled.current || text.toLowerCase().startsWith(settled.current.toLowerCase()) ? text : `${settled.current} ${text}`;
    if (e.isFinal) settled.current = whole;
    onText(whole);
    stopSoon(SILENCE_MS);
  });
  useSpeechRecognitionEvent("error", (e) => {
    if (!mine.current) return;
    mine.current = false;
    clearTimers();
    setListening(false);
    // A pause or a tap on stop is not a fault.
    if (e.error !== "no-speech" && e.error !== "aborted") setError(e.message || e.error);
  });

  const start = useCallback(async () => {
    setError(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError("Microphone or speech recognition is off for Bo. Turn it on in Settings › Bo.");
      return;
    }
    const [hints, mode] = await Promise.all([recognizerHints(), getRecognizerMode()]);
    mine.current = true;
    settled.current = "";
    stopSoon(NOTHING_HEARD_MS);
    cap.current = setTimeout(() => {
      if (mine.current) ExpoSpeechRecognitionModule.stop();
    }, MAX_MS);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      // A pause to think must not end it; Bo stops after SILENCE_MS instead.
      continuous: true,
      addsPunctuation: true,
      // Words Bo knows (areas/_vocabulary.json): biases what's heard, live.
      contextualStrings: hints,
      requiresOnDeviceRecognition: mode === "phone" && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    });
  }, []);

  const stop = useCallback(() => {
    if (mine.current) ExpoSpeechRecognitionModule.stop();
  }, []);

  return { listening, error, start, stop };
}
