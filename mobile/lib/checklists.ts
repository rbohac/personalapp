import { api, must, type Checklist } from "./api";

export type { Checklist };

export async function listChecklists(): Promise<Checklist[]> {
  return must(await api.GET("/checklists"));
}

export async function tickItem(id: string, itemId: string, done: boolean): Promise<Checklist> {
  return must(await api.POST("/checklists/{id}/items/{itemId}", { params: { path: { id, itemId } }, body: { done } }));
}

export async function resetChecklist(id: string): Promise<Checklist> {
  return must(await api.POST("/checklists/{id}/reset", { params: { path: { id } } }));
}

export async function saveChecklist(id: string, title: string, items: string[]): Promise<Checklist> {
  return must(await api.PUT("/checklists/{id}", { params: { path: { id } }, body: { title, items } }));
}
