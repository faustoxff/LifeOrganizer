import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusyBlock } from "@/lib/busy-blocks";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(), loadTasks: vi.fn(), getPrepSettings: vi.fn(), savePrepSettings: vi.fn(), resolveUserTimeZone: vi.fn()
}));
vi.mock("@/lib/db", () => ({ default: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/storage", () => ({ loadTasks: mocks.loadTasks }));
vi.mock("@/lib/user-settings", () => ({
  getPrepSettings: mocks.getPrepSettings, savePrepSettings: mocks.savePrepSettings, resolveUserTimeZone: mocks.resolveUserTimeZone
}));

import { GET, PUT } from "@/app/api/settings/prep/route";
import { getBusyBlocks, getExternalBusyBlocks, busyBlockSources, type BusyBlockSource } from "@/lib/busy-blocks-server";

const BA = "America/Argentina/Buenos_Aires";
const gcal = (over: Partial<BusyBlock> = {}): BusyBlock => ({
  id: "gcal:1", title: "Reunión", source: "calendar", importance: "normal", prepMin: 15,
  start: "2026-09-30T15:00:00Z", end: "2026-09-30T16:00:00Z", ...over
});
const reminder = { id: "r1", title: "Llamar", kind: "reminder", priority: "medium", estimateMin: 5, dueDate: "2026-09-30", time: "10:00", done: false, status: "pending", category: "x", description: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue("user_A");
  mocks.loadTasks.mockResolvedValue([reminder]);
  mocks.getPrepSettings.mockResolvedValue({ calendarMin: 15, reminderMin: 0 });
  mocks.resolveUserTimeZone.mockResolvedValue(BA);
});

describe("getBusyBlocks", () => {
  it("hoy devuelve los recordatorios con hora, en la zona del usuario", async () => {
    const { blocks, timeZone } = await getBusyBlocks("user_A", "2026-09-30", "2026-10-30");
    expect(timeZone).toBe(BA);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: "task:r1", source: "reminder", start: "2026-09-30T13:00:00.000Z" });
  });

  it("lee todo para el usuario que se le pasa", async () => {
    await getBusyBlocks("user_A", "2026-09-30", "2026-10-30");
    expect(mocks.loadTasks).toHaveBeenCalledWith("user_A");
    expect(mocks.getPrepSettings).toHaveBeenCalledWith("user_A");
    expect(mocks.resolveUserTimeZone).toHaveBeenCalledWith("user_A");
  });

  it("el punto de extensión: una fuente externa suma bloques 'calendar' y quien lee no cambia", async () => {
    const source: BusyBlockSource = { name: "google", load: vi.fn(async () => [gcal()]) };
    busyBlockSources.push(source);
    try {
      const { blocks } = await getBusyBlocks("user_A", "2026-09-30", "2026-10-30");
      expect(blocks.map((b) => b.source).sort()).toEqual(["calendar", "reminder"]);
      expect(source.load).toHaveBeenCalledWith("user_A", "2026-09-30", "2026-10-30", { timeZone: BA, prep: { calendarMin: 15, reminderMin: 0 } });
    } finally {
      busyBlockSources.pop();
    }
  });

  it("una fuente que falla se saltea y no rompe la agenda", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: BusyBlockSource = { name: "roto", load: async () => { throw new Error("boom"); } };
    const fine: BusyBlockSource = { name: "ok", load: async () => [gcal()] };
    const out = await getExternalBusyBlocks("user_A", "2026-09-30", "2026-10-30", { timeZone: BA, prep: { calendarMin: 15, reminderMin: 0 } }, [broken, fine]);
    expect(out.map((b) => b.id)).toEqual(["gcal:1"]);
    warn.mockRestore();
  });

  it("un margen configurado por el usuario llega a los bloques", async () => {
    mocks.getPrepSettings.mockResolvedValue({ calendarMin: 30, reminderMin: 10 });
    const { blocks } = await getBusyBlocks("user_A", "2026-09-30", "2026-10-30");
    expect(blocks[0].prepMin).toBe(10);
  });
});

describe("/api/settings/prep", () => {
  const put = (body: unknown) => PUT(new Request("http://x/api/settings/prep", { method: "PUT", body: JSON.stringify(body) }));

  it("sin sesión: 401", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("no"));
    expect((await GET()).status).toBe(401);
    expect((await put({ calendarMin: 15, reminderMin: 0 })).status).toBe(401);
    expect(mocks.savePrepSettings).not.toHaveBeenCalled();
  });

  it("lee y guarda el margen del usuario autenticado", async () => {
    expect(await (await GET()).json()).toEqual({ calendarMin: 15, reminderMin: 0 });
    expect(mocks.getPrepSettings).toHaveBeenCalledWith("user_A");
    const res = await put({ calendarMin: 30, reminderMin: 5 });
    expect(res.status).toBe(200);
    expect(mocks.savePrepSettings).toHaveBeenCalledWith("user_A", { calendarMin: 30, reminderMin: 5 });
  });

  it("rechaza valores inválidos sin guardar nada", async () => {
    for (const body of [{ calendarMin: -1, reminderMin: 0 }, { calendarMin: 15 }, { calendarMin: "15", reminderMin: 0 }, { calendarMin: 241, reminderMin: 0 }, { calendarMin: 1.5, reminderMin: 0 }, null]) {
      expect((await put(body)).status).toBe(400);
    }
    expect(mocks.savePrepSettings).not.toHaveBeenCalled();
  });
});
