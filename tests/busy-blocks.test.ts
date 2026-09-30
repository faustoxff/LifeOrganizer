import { describe, expect, it } from "vitest";
import {
  busyLoadByDate,
  busyLoads,
  collectBusyBlocks,
  DEFAULT_PREP,
  endOfLocalDay,
  formatLocalTime,
  getFreeWindow,
  localToInstant,
  mergeBlocks,
  readPrep,
  type BusyBlock
} from "@/lib/busy-blocks";

const BA = "America/Argentina/Buenos_Aires"; // UTC-3, sin DST
const at = (iso: string) => new Date(iso);

const block = (over: Partial<BusyBlock> & { start: string; end: string }): BusyBlock => ({
  id: over.id ?? `b-${over.start}`,
  title: "Cumpleaños",
  source: "calendar",
  importance: "normal",
  prepMin: 0,
  ...over
});

describe("localToInstant", () => {
  it("convierte la hora local a un instante según la zona del usuario", () => {
    expect(localToInstant("2026-09-30", "09:30", BA).toISOString()).toBe("2026-09-30T12:30:00.000Z");
    expect(localToInstant("2026-09-30", "09:30", "Asia/Tokyo").toISOString()).toBe("2026-09-30T00:30:00.000Z");
    expect(localToInstant("2026-09-30", "09:30", "UTC").toISOString()).toBe("2026-09-30T09:30:00.000Z");
  });

  it("respeta el cambio de horario (DST)", () => {
    // Nueva York: 2026-03-08 es el día que adelantan el reloj (-05 -> -04).
    expect(localToInstant("2026-03-07", "12:00", "America/New_York").toISOString()).toBe("2026-03-07T17:00:00.000Z");
    expect(localToInstant("2026-03-09", "12:00", "America/New_York").toISOString()).toBe("2026-03-09T16:00:00.000Z");
  });

  it("una zona inválida se toma como UTC", () => {
    expect(localToInstant("2026-09-30", "09:30", "Nope/Nowhere").toISOString()).toBe("2026-09-30T09:30:00.000Z");
  });

  it("formatLocalTime es la inversa: muestra la hora del usuario", () => {
    expect(formatLocalTime("2026-09-30T12:30:00.000Z", BA)).toBe("09:30");
    expect(formatLocalTime("2026-09-30T12:30:00.000Z", "Asia/Tokyo")).toBe("21:30");
  });

  it("el fin del día es la medianoche LOCAL, no la de UTC", () => {
    // 2026-09-30 23:00 en Buenos Aires = 02:00Z del 1/10; la medianoche local es 03:00Z del 1/10.
    expect(endOfLocalDay(at("2026-10-01T02:00:00Z"), BA).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

describe("collectBusyBlocks", () => {
  const task = (over: Record<string, unknown>) => ({
    id: "t", title: "x", kind: "reminder" as const, priority: "medium" as const, estimateMin: 5,
    dueDate: "2026-09-30", time: "10:00", done: false, status: "pending" as const, ...over
  });
  const collect = (tasks: ReturnType<typeof task>[], prep = DEFAULT_PREP) =>
    collectBusyBlocks(tasks, { timeZone: BA, from: "2026-09-30", to: "2026-09-30", prep });

  it("un recordatorio con hora es un bloque corto (15 min) en la hora del usuario, sin margen", () => {
    const [b] = collect([task({ id: "r1", title: "Llamar al banco" })]);
    expect(b).toMatchObject({ id: "task:r1", title: "Llamar al banco", source: "reminder", importance: "normal", prepMin: 0 });
    expect(b.start).toBe("2026-09-30T13:00:00.000Z");
    expect(b.end).toBe("2026-09-30T13:15:00.000Z");
  });

  it("una tarea fijada a una hora ocupa su duración y es 'manual'", () => {
    const [b] = collect([task({ id: "k", kind: "task", estimateMin: 60, priority: "high" })]);
    expect(b).toMatchObject({ source: "manual", importance: "high" });
    expect(Date.parse(b.end) - Date.parse(b.start)).toBe(60 * 60_000);
  });

  it("ignora lo hecho, lo salteado, los proyectos, lo sin hora y lo fuera de rango", () => {
    const blocks = collect([
      task({ id: "a", done: true }), task({ id: "b", status: "skipped" }), task({ id: "c", kind: "project" }),
      task({ id: "d", time: undefined }), task({ id: "e", dueDate: "2026-10-05" }), task({ id: "f", time: "25:00" })
    ]);
    expect(blocks).toEqual([]);
  });

  it("usa el margen configurado por el usuario y ordena por hora", () => {
    const blocks = collect([task({ id: "late", time: "18:00" }), task({ id: "early", time: "08:00" })], { calendarMin: 15, reminderMin: 10 });
    expect(blocks.map((b) => b.id)).toEqual(["task:early", "task:late"]);
    expect(blocks.every((b) => b.prepMin === 10)).toBe(true);
  });

  it("mergeBlocks une fuentes sin repetir ids", () => {
    const a = block({ id: "1", start: "2026-09-30T15:00:00Z", end: "2026-09-30T16:00:00Z" });
    const b = block({ id: "2", start: "2026-09-30T14:00:00Z", end: "2026-09-30T14:30:00Z" });
    expect(mergeBlocks([a], [b, a]).map((x) => x.id)).toEqual(["2", "1"]);
  });

  it("readPrep cae al default con basura", () => {
    expect(readPrep(null, undefined)).toEqual({ calendarMin: 15, reminderMin: 0 });
    expect(readPrep(30, 5)).toEqual({ calendarMin: 30, reminderMin: 5 });
    expect(readPrep(-1, 9999)).toEqual({ calendarMin: 15, reminderMin: 0 });
  });
});

describe("getFreeWindow", () => {
  // 2026-09-30 10:00 en Buenos Aires
  const NOW = at("2026-09-30T13:00:00Z");
  const win = (blocks: BusyBlock[], extra: Record<string, unknown> = {}) => getFreeWindow({ now: NOW, blocks, timeZone: BA, ...extra });

  it("sin bloques: hasta el fin del día", () => {
    const w = win([]);
    expect(w).toMatchObject({ freeMin: 14 * 60, nextBlock: null, currentBlock: null, limit: "end_of_day" });
  });

  it("sin bloques, la disponibilidad del día es el tope", () => {
    expect(win([], { dayCapacityMin: 120 })).toMatchObject({ freeMin: 120, limit: "capacity" });
    expect(win([], { dayCapacityMin: 5000 })).toMatchObject({ freeMin: 14 * 60, limit: "end_of_day" });
  });

  it("un bloque en 30 minutos, con y sin margen", () => {
    const start = "2026-09-30T13:30:00Z"; // 10:30
    const noPrep = win([block({ start, end: "2026-09-30T14:30:00Z", prepMin: 0 })]);
    expect(noPrep).toMatchObject({ freeMin: 30, limit: "block", minutesToBlock: 30 });
    const withPrep = win([block({ id: "cal", start, end: "2026-09-30T14:30:00Z", prepMin: 15 })]);
    expect(withPrep.freeMin).toBe(15);
    expect(withPrep.nextBlock?.id).toBe("cal");
  });

  it("dentro del margen del bloque no queda tiempo, pero el bloque sigue siendo el próximo", () => {
    const w = win([block({ id: "cal", start: "2026-09-30T13:10:00Z", end: "2026-09-30T14:00:00Z", prepMin: 15 })]);
    expect(w).toMatchObject({ freeMin: 0, minutesToBlock: 0, limit: "block" });
    expect(w.nextBlock?.id).toBe("cal");
  });

  it("un bloque ya empezado: 0 minutos y se informa el bloque actual y el que sigue", () => {
    const current = block({ id: "now", start: "2026-09-30T12:30:00Z", end: "2026-09-30T13:45:00Z" });
    const later = block({ id: "later", start: "2026-09-30T18:00:00Z", end: "2026-09-30T19:00:00Z" });
    const w = win([current, later]);
    expect(w).toMatchObject({ freeMin: 0, limit: "in_block" });
    expect(w.currentBlock?.id).toBe("now");
    expect(w.nextBlock?.id).toBe("later");
  });

  it("un bloque que ya terminó no cuenta", () => {
    const w = win([block({ start: "2026-09-30T11:00:00Z", end: "2026-09-30T12:00:00Z" })]);
    expect(w).toMatchObject({ nextBlock: null, currentBlock: null });
  });

  it("elige como próximo al que primero pisa su margen, no al que empieza primero", () => {
    const a = block({ id: "a", start: "2026-09-30T14:00:00Z", end: "2026-09-30T14:30:00Z", prepMin: 0 }); // límite 14:00Z
    const b = block({ id: "b", start: "2026-09-30T14:10:00Z", end: "2026-09-30T15:00:00Z", prepMin: 30 }); // límite 13:40Z
    expect(win([a, b]).nextBlock?.id).toBe("b");
    expect(win([a, b]).freeMin).toBe(40);
  });

  it("un bloque de mañana no limita el día de hoy", () => {
    const w = win([block({ start: "2026-10-01T13:00:00Z", end: "2026-10-01T14:00:00Z" })]);
    expect(w).toMatchObject({ nextBlock: null, limit: "end_of_day" });
  });

  it("el fin del día usa la zona del usuario", () => {
    // 23:30 en Buenos Aires = 02:30Z del 1/10: quedan 30 minutos hasta la medianoche LOCAL.
    const late = getFreeWindow({ now: at("2026-10-01T02:30:00Z"), blocks: [], timeZone: BA });
    expect(late.freeMin).toBe(30);
    // En Tokio ese mismo instante son las 11:30 del 1/10: quedan 12,5 h.
    expect(getFreeWindow({ now: at("2026-10-01T02:30:00Z"), blocks: [], timeZone: "Asia/Tokyo" }).freeMin).toBe(12 * 60 + 30);
  });
});

describe("carga de la agenda para el scheduler", () => {
  const blocks = [
    block({ id: "cal", source: "calendar", start: "2026-09-30T15:00:00Z", end: "2026-09-30T17:00:00Z", prepMin: 15, title: "Casamiento" }),
    block({ id: "rem", source: "reminder", start: "2026-09-30T18:00:00Z", end: "2026-09-30T18:15:00Z", prepMin: 0 }),
    block({ id: "man", source: "manual", start: "2026-10-01T12:00:00Z", end: "2026-10-01T13:00:00Z", prepMin: 10 })
  ];

  it("un evento de calendario resta su duración y su margen; un recordatorio sin margen, nada", () => {
    expect(busyLoads(blocks, BA)).toEqual([
      { date: "2026-09-30", title: "Casamiento", minutes: 135 },
      { date: "2026-10-01", title: "Cumpleaños", minutes: 10 } // de lo fijado a mano solo el margen: su duración ya es carga fija
    ]);
  });

  it("se suma por fecha local del usuario", () => {
    expect(busyLoadByDate(blocks, BA)).toEqual({ "2026-09-30": 135, "2026-10-01": 10 });
    // Un evento a las 23:30 locales cae, en UTC, al día siguiente: se cuenta en el día del usuario.
    const late = [block({ source: "calendar", start: "2026-10-01T02:30:00Z", end: "2026-10-01T03:00:00Z" })];
    expect(busyLoadByDate(late, BA)).toEqual({ "2026-09-30": 30 });
  });
});
