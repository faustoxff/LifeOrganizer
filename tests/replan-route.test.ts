import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(), replanAll: vi.fn(), listUnseenMoves: vi.fn(), markMovesSeen: vi.fn(), undoPlannedMove: vi.fn(),
  moveFixedToDate: vi.fn(), dismissTask: vi.fn(), extendDeadline: vi.fn(), loadTasks: vi.fn(), setTaskDone: vi.fn(),
  resolveUserTimeZone: vi.fn(), getAvailabilitySettings: vi.fn(), saveAvailabilitySettings: vi.fn()
}));
vi.mock("@/lib/db", () => ({ default: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/replan", () => ({ replanAll: mocks.replanAll }));
vi.mock("@/lib/replan-storage", () => ({
  listUnseenMoves: mocks.listUnseenMoves, markMovesSeen: mocks.markMovesSeen, undoPlannedMove: mocks.undoPlannedMove,
  moveFixedToDate: mocks.moveFixedToDate, dismissTask: mocks.dismissTask, extendDeadline: mocks.extendDeadline
}));
vi.mock("@/lib/storage", () => ({ loadTasks: mocks.loadTasks, setTaskDone: mocks.setTaskDone }));
vi.mock("@/lib/user-settings", () => ({
  resolveUserTimeZone: mocks.resolveUserTimeZone, getAvailabilitySettings: mocks.getAvailabilitySettings, saveAvailabilitySettings: mocks.saveAvailabilitySettings
}));

import { GET, POST } from "@/app/api/replan/route";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";

const post = (body: unknown) => POST(new Request("http://x/api/replan", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.requireAuth.mockResolvedValue("user_A");
  mocks.resolveUserTimeZone.mockResolvedValue("America/Argentina/Buenos_Aires");
  mocks.replanAll.mockResolvedValue({ ran: true, moved: [{}, {}], conflicts: [{}] });
  mocks.listUnseenMoves.mockResolvedValue([{ id: "m1", taskId: "t", title: "T", from: "2026-09-29", to: "2026-10-01" }]);
  mocks.undoPlannedMove.mockResolvedValue({ id: "t" });
  mocks.moveFixedToDate.mockResolvedValue(true);
  mocks.dismissTask.mockResolvedValue(true);
  mocks.extendDeadline.mockResolvedValue(true);
  mocks.loadTasks.mockResolvedValue([{ id: "t", dueDate: "2026-10-02", kind: "task" }]);
  mocks.getAvailabilitySettings.mockResolvedValue({ availability: DEFAULT_AVAILABILITY, overrides: {}, configured: true });
});

describe("/api/replan", () => {
  it("sin sesión: 401 y no toca nada", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("no"));
    expect((await GET()).status).toBe(401);
    expect((await post({ action: "seen" })).status).toBe(401);
    expect(mocks.markMovesSeen).not.toHaveBeenCalled();
  });

  it("GET devuelve lo no visto del usuario autenticado", async () => {
    const res = await GET();
    expect(mocks.listUnseenMoves).toHaveBeenCalledWith("user_A");
    expect((await res.json()).moves).toHaveLength(1);
  });

  it("seen y undo trabajan para el usuario autenticado", async () => {
    await post({ action: "seen" });
    expect(mocks.markMovesSeen).toHaveBeenCalledWith("user_A");
    const res = await post({ action: "undo", moveId: "m1" });
    expect(mocks.undoPlannedMove).toHaveBeenCalledWith("user_A", "m1");
    expect(await res.json()).toMatchObject({ undone: true });
    mocks.undoPlannedMove.mockResolvedValue(null);
    expect(await (await post({ action: "undo", moveId: "m1" })).json()).toMatchObject({ undone: false });
  });

  it("un userId del cuerpo no cambia de quién son los datos", async () => {
    await post({ action: "undo", moveId: "m1", userId: "otro", user_id: "otro" });
    expect(mocks.undoPlannedMove).toHaveBeenCalledWith("user_A", "m1");
  });

  it("run: replanifica todo, forzado, con el hoy del usuario", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T01:00:00Z")); // en Buenos Aires todavía es 30/9
    const res = await post({ action: "run" });
    expect(mocks.replanAll).toHaveBeenCalledWith("user_A", "2026-09-30", { force: true });
    expect(await res.json()).toEqual({ moved: 2, conflicts: 1 });
  });

  it("recordatorio vencido: hecho, pasar a mañana (en la zona del usuario) y descartar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T01:00:00Z"));
    await post({ action: "fixed", taskId: "r", op: "done" });
    expect(mocks.setTaskDone).toHaveBeenCalledWith("r", true, "user_A");
    await post({ action: "fixed", taskId: "r", op: "tomorrow" });
    expect(mocks.moveFixedToDate).toHaveBeenCalledWith("user_A", "r", "2026-10-01");
    await post({ action: "fixed", taskId: "r", op: "dismiss" });
    expect(mocks.dismissTask).toHaveBeenCalledWith("user_A", "r");
    mocks.moveFixedToDate.mockResolvedValue(false);
    expect((await post({ action: "fixed", taskId: "r", op: "tomorrow" })).status).toBe(404);
  });

  it("conflicto: correr la fecha límite suma días a la de la tarea y vuelve a replanificar", async () => {
    const res = await post({ action: "resolve", op: "extend", taskId: "t", days: 3 });
    expect(mocks.extendDeadline).toHaveBeenCalledWith("user_A", "t", "2026-10-05");
    expect(mocks.replanAll).toHaveBeenCalledWith("user_A", expect.any(String), { force: true });
    expect(res.status).toBe(200);
  });

  it("conflicto: más minutos por día los suma a la disponibilidad y replanifica", async () => {
    await post({ action: "resolve", op: "minutes", minutes: 30 });
    const [, availability] = mocks.saveAvailabilitySettings.mock.calls[0];
    expect(availability["1"]).toBe(DEFAULT_AVAILABILITY["1"] + 30);
    expect(mocks.replanAll).toHaveBeenCalled();
  });

  it("valida todo y no toca nada si algo está mal", async () => {
    for (const body of [
      {}, { action: 1 }, { action: "explotar" }, { action: "undo" }, { action: "fixed", taskId: "r", op: "borrar" }, { action: "fixed", op: "done" },
      { action: "resolve", op: "extend", taskId: "t", days: 0 }, { action: "resolve", op: "extend", taskId: "t", days: 999 }, { action: "resolve", op: "extend", taskId: "t", days: 1.5 },
      { action: "resolve", op: "minutes", minutes: -5 }, { action: "resolve", op: "minutes", minutes: 5000 }, { action: "resolve", op: "otra" }
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(mocks.extendDeadline).not.toHaveBeenCalled();
    expect(mocks.saveAvailabilitySettings).not.toHaveBeenCalled();
    expect(mocks.setTaskDone).not.toHaveBeenCalled();
  });

  it("una tarea que no es del usuario responde 404 al correr la fecha", async () => {
    mocks.loadTasks.mockResolvedValue([]);
    expect((await post({ action: "resolve", op: "extend", taskId: "ajena", days: 2 })).status).toBe(404);
  });
});
