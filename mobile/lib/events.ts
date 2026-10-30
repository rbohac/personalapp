/**
 * "Tasks changed somewhere else" — a reminder button, the edit screen — so a
 * list that is already on screen refetches. One event, no payload: the list
 * re-reads the server rather than trying to patch itself.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onTasksChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tasksChanged(): void {
  for (const fn of listeners) fn();
}
