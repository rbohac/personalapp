import { api, must, type CaptureResult, type EntryInput, type Proposal } from "./api";
import { createEntry } from "./areas";
import { changed } from "./events";
import { createTask } from "./tasks";

export type CaptureSource = "typed" | "voice";

/** Read what was typed or said. Saves nothing — the screen shows the proposals first. */
export async function capture(text: string, source: CaptureSource): Promise<CaptureResult> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return must(await api.POST("/capture", { body: { text, timeZone, source } }));
}

/** Save one proposal the owner kept, through the same endpoints a hand-made one uses. */
export async function saveProposal(p: Proposal, raw: string, source: CaptureSource): Promise<void> {
  if (p.kind === "task" && p.task) {
    await createTask({ title: p.task.title, list: p.task.list, dueAt: p.task.dueAt, remindAt: p.task.remindAt });
    changed("tasks");
    return;
  }
  await createEntry({ area: p.area, at: p.at, data: p.data as EntryInput["data"], source, raw });
}
