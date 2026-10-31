/**
 * "Something changed somewhere else" — a reminder button, an edit screen, a
 * capture — so a list already on screen refetches. No payload: the list
 * re-reads the server rather than trying to patch itself.
 */
export type Topic = "tasks" | "entries";
type Listener = () => void;
const listeners: Record<Topic, Set<Listener>> = { tasks: new Set(), entries: new Set() };

export function onChanged(topic: Topic, fn: Listener): () => void {
  listeners[topic].add(fn);
  return () => listeners[topic].delete(fn);
}

export function changed(topic: Topic): void {
  for (const fn of listeners[topic]) fn();
}
