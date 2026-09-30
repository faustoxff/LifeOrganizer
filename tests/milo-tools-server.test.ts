import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";

/**
 * El modelo nunca elige de quién son los datos. Estas tools se arman con el usuario
 * autenticado y CADA lectura recibe ese id; los argumentos del modelo, aunque traigan un
 * `userId`, no llegan a ningún lado.
 */

const loadTasks = vi.fn();
const loadProjectRecords = vi.fn();
const loadHistory = vi.fn();
const getAvailabilitySettings = vi.fn();

vi.mock("@/lib/storage", () => ({ loadTasks: (...a: unknown[]) => loadTasks(...a) }));
vi.mock("@/lib/projects-storage", () => ({ loadProjectRecords: (...a: unknown[]) => loadProjectRecords(...a) }));
// El loader real lee la base; acá se reemplaza por uno que arma los patrones con el historial del test.
vi.mock("@/lib/user-history", async () => {
  const { computePatterns } = await import("@/lib/user-patterns");
  return { patternsLoader: (userId: string) => async () => computePatterns(await loadHistory(userId)) };
});
vi.mock("@/lib/facts-storage", () => ({ listFacts: vi.fn(async () => []), saveFact: vi.fn(async () => ({ status: "saved" })) }));
vi.mock("@/lib/user-settings", () => ({ getAvailabilitySettings: (...a: unknown[]) => getAvailabilitySettings(...a) }));

import { executeTool } from "@/lib/milo-tools";
import { createToolContext } from "@/lib/milo-tools-server";

const NOW = new Date("2026-09-28T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  loadTasks.mockResolvedValue([
    { id: "t1", title: "Mía", kind: "task", priority: "medium", estimateMin: 30, dueDate: "2026-09-29", done: false, status: "pending" }
  ]);
  loadProjectRecords.mockResolvedValue([
    {
      task: { id: "p1", title: "TFG", done: false },
      subtasks: [
        { id: "s1", title: "Capítulo 1", done: false },
        { id: "s2", title: "Capítulo 2", done: true }
      ],
      sessions: [
        { subtaskId: "s1", date: "2026-09-29", minutes: 60 },
        { subtaskId: "s2", date: "2026-09-29", minutes: 90 }
      ]
    },
    { task: { id: "p2", title: "Terminado", done: true }, subtasks: [{ id: "s3", title: "X", done: false }], sessions: [{ subtaskId: "s3", date: "2026-09-29", minutes: 45 }] }
  ]);
  loadHistory.mockResolvedValue([]);
  getAvailabilitySettings.mockResolvedValue({ availability: DEFAULT_AVAILABILITY, overrides: {}, configured: true });
});

describe("createToolContext", () => {
  it("cada lectura recibe el usuario autenticado y nada más", async () => {
    const ctx = createToolContext("user_A", "2026-09-28", NOW);
    await ctx.load();
    for (const reader of [loadTasks, loadProjectRecords, loadHistory, getAvailabilitySettings]) {
      expect(reader).toHaveBeenCalledTimes(1);
      expect(reader).toHaveBeenCalledWith("user_A");
    }
  });

  it("un userId en los argumentos del modelo no cambia de quién son los datos", async () => {
    const ctx = createToolContext("user_A", "2026-09-28", NOW);
    await executeTool(
      { id: "1", name: "get_schedule", arguments: JSON.stringify({ from: "2026-09-28", to: "2026-09-30", userId: "user_B", user_id: "user_B" }) },
      ctx
    );
    await executeTool(
      { id: "2", name: "plan_week", arguments: JSON.stringify({ items: [{ title: "A", kind: "task" }], userId: "user_B" }) },
      ctx
    );
    for (const reader of [loadTasks, loadProjectRecords, loadHistory, getAvailabilitySettings]) {
      for (const args of reader.mock.calls) expect(args).toEqual(["user_A"]);
    }
  });

  it("lee una sola vez por turno aunque haya varias tools", async () => {
    const ctx = createToolContext("user_A", "2026-09-28", NOW);
    await executeTool({ id: "1", name: "get_schedule", arguments: '{"from":"2026-09-28","to":"2026-09-28"}' }, ctx);
    await executeTool({ id: "2", name: "get_schedule", arguments: '{"from":"2026-09-29","to":"2026-09-29"}' }, ctx);
    expect(loadTasks).toHaveBeenCalledTimes(1);
  });

  it("no lee nada si ninguna tool lo necesita", async () => {
    const ctx = createToolContext("user_A", "2026-09-28", NOW);
    await executeTool({ id: "1", name: "ask_user", arguments: '{"question":"¿cuál?"}' }, ctx);
    await executeTool({ id: "2", name: "create_items", arguments: '{"items":[{"title":"A","kind":"task","dueDate":"2026-09-29"}]}' }, ctx);
    expect(loadTasks).not.toHaveBeenCalled();
  });

  it("las sesiones de un proyecto terminado o de una subtarea hecha no cuentan", async () => {
    const ctx = createToolContext("user_A", "2026-09-28", NOW);
    const data = await ctx.load();
    expect(data.sessions).toEqual([{ date: "2026-09-29", minutes: 60, title: "TFG · Capítulo 1" }]);
  });

  it("sin historial suficiente no infla; con historial usa el factor aprendido", async () => {
    expect((await createToolContext("user_A", "2026-09-28", NOW).load()).inflation).toBe(1);
    loadHistory.mockResolvedValue(Array.from({ length: 6 }, () => ({ title: "t", category: "study", estimateMin: 30, actualMin: 45, completed: true, completedHour: null, postponedCount: 0 })));
    expect((await createToolContext("user_A", "2026-09-28", NOW).load()).inflation).toBe(1.5);
  });
});
