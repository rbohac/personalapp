import { api, must, type AskResult, type AskTurn, type Trends } from "./api";

/** Ask Bo and Trends: reading back what's been logged. */
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A question in plain words; `history` is the conversation so far, for follow-ups. */
export async function ask(question: string, history: AskTurn[]): Promise<AskResult> {
  return must(await api.POST("/ask", { body: { question, timeZone: tz(), history: history.slice(-6), days: 90 } }));
}

export async function trends(days: number): Promise<Trends> {
  return must(await api.GET("/trends", { params: { query: { tz: tz(), days } } }));
}
