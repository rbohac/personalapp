import { api, must, type Goal, type GoalInput } from "./api";
import { changed } from "./events";

/**
 * Goals, per week ("walk at least 4 days", "10 miles") or per day ("15
 * minutes of household work"). The server works progress out from entries;
 * a week is Monday to Sunday.
 */
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function listGoals(): Promise<Goal[]> {
  return must(await api.GET("/goals", { params: { query: { tz: tz() } } }));
}

export async function createGoal(input: GoalInput): Promise<Goal> {
  const g = must(await api.POST("/goals", { body: input }));
  changed("goals");
  return g;
}

export async function updateGoal(id: string, input: GoalInput): Promise<Goal> {
  const g = must(await api.PUT("/goals/{id}", { params: { path: { id } }, body: input }));
  changed("goals");
  return g;
}

export async function deleteGoal(id: string): Promise<void> {
  must(await api.DELETE("/goals/{id}", { params: { path: { id } } }));
  changed("goals");
}

export function goalInputOf(g: Goal): GoalInput {
  return {
    title: g.title, area: g.area, measure: g.measure, target: Number(g.target), field: g.field,
    excludeField: g.excludeField, excludeValues: g.excludeValues, paused: g.paused, period: g.period,
  };
}
