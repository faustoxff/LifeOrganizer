import "server-only";
import type { ScheduleData, ToolContext } from "@/lib/milo-tools";
import { listFacts, saveFact } from "@/lib/facts-storage";
import { loadProjectRecords } from "@/lib/projects-storage";
import { patternsLoader } from "@/lib/user-history";
import { loadTasks } from "@/lib/storage";
import { getAvailabilitySettings } from "@/lib/user-settings";

/**
 * Ata las tools de Milo al usuario autenticado. Es el ÚNICO lugar donde un `userId`
 * entra a las tools: los argumentos del modelo no lo traen ni lo pueden cambiar, y cada
 * lectura de acá filtra por él. Los datos se leen una sola vez por turno, y solo si una
 * tool los pide.
 */
export function createToolContext(userId: string, today: string, now: Date, userMessage = ""): ToolContext {
  let cached: Promise<ScheduleData> | null = null;
  // Una sola lectura del historial por turno, compartida entre `plan_week` y `get_my_patterns`.
  const patterns = patternsLoader(userId, now);

  return {
    today,
    now,
    userMessage,
    turn: { factCalls: 0 },
    facts: {
      list: () => listFacts(userId),
      save: (input) => saveFact(userId, input)
    },
    patterns,
    load() {
      cached ??= readScheduleData(userId, patterns);
      return cached;
    }
  };
}

async function readScheduleData(userId: string, loadPatterns: ReturnType<typeof patternsLoader>): Promise<ScheduleData> {
  const [tasks, records, settings, patterns] = await Promise.all([
    loadTasks(userId),
    loadProjectRecords(userId),
    getAvailabilitySettings(userId),
    loadPatterns()
  ]);

  const sessions = records
    .filter((record) => !record.task.done)
    .flatMap((record) =>
      record.sessions
        .map((session) => ({ session, subtask: record.subtasks.find((s) => s.id === session.subtaskId) }))
        // La agenda guardada puede tener una sesión de una subtarea que ya se hizo.
        .filter(({ subtask }) => subtask && !subtask.done)
        .map(({ session, subtask }) => ({
          date: session.date,
          minutes: session.minutes,
          title: `${record.task.title} · ${subtask!.title}`
        }))
    );

  const { global, categories } = patterns.inflation;
  return {
    tasks,
    sessions,
    availability: settings.availability,
    overrides: settings.overrides,
    // Sin historial suficiente el default (1.3) es una suposición: para repartir tareas
    // sueltas se usa la estimación tal cual en vez de inflarlas por un promedio ajeno.
    // Una categoría con medición propia manda sobre el global.
    inflation: global.learned ? global.factor : 1,
    inflationByCategory: Object.fromEntries(
      Object.entries(categories)
        .filter(([, entry]) => entry.source === "category")
        .map(([category, entry]) => [category, entry.factor])
    )
  };
}
