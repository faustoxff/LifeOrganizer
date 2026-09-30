import "server-only";
import { learnInflation } from "@/lib/estimate-learning";
import type { ScheduleData, ToolContext } from "@/lib/milo-tools";
import { listFacts, saveFact } from "@/lib/facts-storage";
import { loadEstimateHistory, loadProjectRecords } from "@/lib/projects-storage";
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

  return {
    today,
    now,
    userMessage,
    turn: { factCalls: 0 },
    facts: {
      list: () => listFacts(userId),
      save: (input) => saveFact(userId, input)
    },
    load() {
      cached ??= readScheduleData(userId);
      return cached;
    }
  };
}

async function readScheduleData(userId: string): Promise<ScheduleData> {
  const [tasks, records, settings, history] = await Promise.all([
    loadTasks(userId),
    loadProjectRecords(userId),
    getAvailabilitySettings(userId),
    loadEstimateHistory(userId)
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

  const learned = learnInflation(history);
  return {
    tasks,
    sessions,
    availability: settings.availability,
    overrides: settings.overrides,
    // Sin historial suficiente el default (1.3) es una suposición: para repartir tareas
    // sueltas se usa la estimación tal cual en vez de inflarlas por un promedio ajeno.
    inflation: learned.learned ? learned.factor : 1
  };
}
