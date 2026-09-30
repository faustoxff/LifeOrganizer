import "server-only";
import type { ScheduleData, ToolContext } from "@/lib/milo-tools";
import { listFacts, saveFact } from "@/lib/facts-storage";
import { loadProjectRecords } from "@/lib/projects-storage";
import { patternsLoader } from "@/lib/user-history";
import { getBusyBlocks } from "@/lib/busy-blocks-server";
import { addDays } from "@/lib/recurrence";
import { loadTasks, setTaskPinned } from "@/lib/storage";
import { replanAll } from "@/lib/replan";
import { normalizeText } from "@/lib/text-normalize";
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
    // replan_now y pin_task HACEN el cambio (reversible): siempre para el usuario autenticado.
    replan: {
      async run({ skipToday }) {
        const report = await replanAll(userId, today, { force: true, skipToday });
        return {
          moved: report.moved.map((m) => ({ title: m.title, from: m.from, to: m.to })),
          conflicts: report.conflicts.map((c) => ({ title: c.title, dueDate: c.dueDate }))
        };
      }
    },
    pin: {
      async find({ title, dueDate }) {
        const tokens = normalizeText(title).split(/\s+/).filter((t) => t.length >= 2);
        const tasks = await loadTasks(userId);
        return tasks
          .filter((t) => t.kind === "task" && !t.done && t.status !== "skipped")
          .filter((t) => !dueDate || t.dueDate === dueDate)
          .filter((t) => {
            const haystack = normalizeText(t.title);
            return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
          })
          .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, pinned: t.pinned === true }));
      },
      async set(id, pinned) {
        return (await setTaskPinned(id, pinned, userId)) !== null;
      }
    },
    load() {
      cached ??= readScheduleData(userId, today, patterns);
      return cached;
    }
  };
}

async function readScheduleData(userId: string, today: string, loadPatterns: ReturnType<typeof patternsLoader>): Promise<ScheduleData> {
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
          title: `${record.task.title} · ${subtask!.title}`,
          subtaskId: session.subtaskId,
          deadline: record.task.dueDate
        }))
    );

  // Los compromisos con hora de los próximos 90 días: `plan_week` no los carga con trabajo y
  // `what_should_i_do_now` los usa para saber cuánto tiempo libre hay.
  const busy = await getBusyBlocks(userId, today, addDays(today, 90), { tasks });
  const { global, categories } = patterns.inflation;
  return {
    tasks,
    sessions,
    availability: settings.availability,
    overrides: settings.overrides,
    // Sin historial suficiente el default (1.3) es una suposición: para repartir tareas
    // sueltas se usa la estimación tal cual en vez de inflarlas por un promedio ajeno.
    // Una categoría con medición propia manda sobre el global.
    busyBlocks: busy.blocks,
    timeZone: busy.timeZone,
    inflation: global.learned ? global.factor : 1,
    inflationByCategory: Object.fromEntries(
      Object.entries(categories)
        .filter(([, entry]) => entry.source === "category")
        .map(([category, entry]) => [category, entry.factor])
    )
  };
}
