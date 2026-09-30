import "server-only";
import { classifyTitles, generateInitialList } from "@/lib/checklist-ai";
import {
  loadList,
  loadTaskForChecklist,
  loadTitleActivities,
  saveList,
  saveTaskChecklist,
  saveTitleActivities
} from "@/lib/checklists-storage";
import type { ChecklistContext, ChecklistDeps, ChecklistStore } from "@/lib/checklists-service";
import { listFacts } from "@/lib/facts-storage";
import type { UserPlan } from "@/lib/server-auth";
import { consumeDailyUsage } from "@/lib/usage-limits";
import { getApproxLocation } from "@/lib/user-settings";
import { fetchWeather } from "@/lib/weather";

/** El store de producción: cada lectura y escritura filtra por el usuario que le pasan. */
export const checklistStore: ChecklistStore = {
  loadTask: loadTaskForChecklist,
  saveTaskChecklist,
  loadList,
  saveList,
  loadTitleActivities,
  saveTitleActivities,
  listFacts,
  getLocation: getApproxLocation
};

/** Las dependencias reales del servicio, atadas al usuario y a su plan (que decide la cuota). */
export function checklistDeps(ctx: Pick<ChecklistContext, "userId">, plan: UserPlan): ChecklistDeps {
  return {
    store: checklistStore,
    now: () => new Date(),
    gate: async (kind) => (await consumeDailyUsage(ctx.userId, kind, plan)).allowed,
    generate: (input) => generateInitialList(ctx.userId, input),
    classify: (titles) => classifyTitles(ctx.userId, titles),
    weather: (place, date, daysAhead) => fetchWeather(place, date, daysAhead)
  };
}
