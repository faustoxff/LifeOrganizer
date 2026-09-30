import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PATCH /api/tasks: qué se guarda al completar. La base está reemplazada; lo que se
 * comprueba es lo que la ruta le pide a `setTaskDone` (minutos, hora en la zona del usuario).
 */
const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  setTaskDone: vi.fn(),
  addTaskProgress: vi.fn(),
  resolveUserTimeZone: vi.fn(),
  learnFromCompletion: vi.fn()
}));

vi.mock("@/lib/db", () => ({ default: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ requireAuth: mocks.requireAuth, getUserPlan: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  loadTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(), deleteTaskById: vi.fn(),
  countUserTasks: vi.fn(), countUserLooseTasks: vi.fn(),
  setTaskDone: mocks.setTaskDone,
  addTaskProgress: mocks.addTaskProgress
}));
vi.mock("@/lib/series-storage", () => ({
  countActiveSeries: vi.fn(), ensureOccurrences: vi.fn(), insertSeries: vi.fn(), loadSeriesOccurrences: vi.fn(), seriesStore: {}
}));
vi.mock("@/lib/checklists-runtime", () => ({ checklistStore: {} }));
vi.mock("@/lib/checklists-service", () => ({ learnFromCompletion: mocks.learnFromCompletion }));
vi.mock("@/lib/user-settings", () => ({ resolveUserTimeZone: mocks.resolveUserTimeZone }));

import { PATCH } from "@/app/api/tasks/route";

const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/tasks", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue("user_A");
  mocks.setTaskDone.mockResolvedValue({ id: "t1", done: true });
  mocks.addTaskProgress.mockResolvedValue(true);
  mocks.resolveUserTimeZone.mockResolvedValue("UTC");
});

describe("completar una tarea", () => {
  it("por tilde: guarda la hora y NO inventa minutos", async () => {
    expect((await patch({ taskId: "t1", done: true })).status).toBe(200);
    expect(mocks.setTaskDone).toHaveBeenCalledWith("t1", true, "user_A", { actualMin: null, completedHour: expect.any(Number) });
  });

  it("desde el modo foco: guarda los minutos reales", async () => {
    await patch({ taskId: "t1", done: true, actualMin: 42 });
    expect(mocks.setTaskDone).toHaveBeenCalledWith("t1", true, "user_A", expect.objectContaining({ actualMin: 42 }));
  });

  it("la hora es la de la zona del usuario, no la del servidor", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-30T01:30:00Z"));
      mocks.resolveUserTimeZone.mockResolvedValue("America/Argentina/Buenos_Aires");
      await patch({ taskId: "t1", done: true });
      expect(mocks.resolveUserTimeZone).toHaveBeenCalledWith("user_A");
      expect(mocks.setTaskDone).toHaveBeenLastCalledWith("t1", true, "user_A", { actualMin: null, completedHour: 22 });

      mocks.resolveUserTimeZone.mockResolvedValue("Asia/Tokyo");
      await patch({ taskId: "t1", done: true });
      expect(mocks.setTaskDone).toHaveBeenLastCalledWith("t1", true, "user_A", { actualMin: null, completedHour: 10 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reabrir no guarda hora ni minutos", async () => {
    await patch({ taskId: "t1", done: false, actualMin: 30 });
    expect(mocks.setTaskDone).toHaveBeenCalledWith("t1", false, "user_A", { actualMin: 30, completedHour: null });
    expect(mocks.learnFromCompletion).not.toHaveBeenCalled();
  });

  it("rechaza minutos inválidos", async () => {
    for (const actualMin of [0, -5, 1.5, "30", 5000]) {
      expect((await patch({ taskId: "t1", done: true, actualMin })).status).toBe(400);
    }
    expect(mocks.setTaskDone).not.toHaveBeenCalled();
  });

  it("sin sesión responde 401 y no toca nada", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("no session"));
    expect((await patch({ taskId: "t1", done: true })).status).toBe(401);
    expect(mocks.setTaskDone).not.toHaveBeenCalled();
  });
});

describe("cerrar el foco sin completar", () => {
  it("suma los minutos al usuario autenticado", async () => {
    expect((await patch({ taskId: "t1", progressMin: 25 })).status).toBe(200);
    expect(mocks.addTaskProgress).toHaveBeenCalledWith("t1", 25, "user_A");
    expect(mocks.setTaskDone).not.toHaveBeenCalled();
  });

  it("valida los minutos y responde 404 si la tarea no es del usuario", async () => {
    expect((await patch({ taskId: "t1", progressMin: 0 })).status).toBe(400);
    expect((await patch({ taskId: "t1", progressMin: "10" })).status).toBe(400);
    mocks.addTaskProgress.mockResolvedValue(false);
    expect((await patch({ taskId: "t1", progressMin: 10 })).status).toBe(404);
  });
});
