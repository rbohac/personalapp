import { useCallback, useRef, useState } from "react";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";

/**
 * Speech to text for the capture box, on the phone (on-device recognition
 * where iOS supports it). `onText` receives the whole transcript so far,
 * replacing rather than appending, because interim results revise earlier
 * words as more is heard.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Speech events are global; only react to a session this hook started.
  const mine = useRef(false);

  useSpeechRecognitionEvent("start", () => {
    if (mine.current) setListening(true);
  });
  useSpeechRecognitionEvent("end", () => {
    if (!mine.current) return;
    mine.current = false;
    setListening(false);
  });
  useSpeechRecognitionEvent("result", (e) => {
    if (!mine.current) return;
    const text = e.results[0]?.transcript;
    if (text) onText(text);
  });
  useSpeechRecognitionEvent("error", (e) => {
    if (!mine.current) return;
    mine.current = false;
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
    mine.current = true;
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    });
  }, []);

  const stop = useCallback(() => {
    if (mine.current) ExpoSpeechRecognitionModule.stop();
  }, []);

  return { listening, error, start, stop };
}
