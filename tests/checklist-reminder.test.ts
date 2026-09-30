import { describe, expect, it } from "vitest";
import { DEFAULT_LEAD_MIN, dueChecklistReminders, pendingItems, readLead, reminderEnabled, shouldOffer } from "@/lib/checklist-reminder";
import type { TaskChecklist } from "@/lib/checklist";
import type { Task } from "@/types/task";

const checklist = (items: TaskChecklist["items"]): TaskChecklist => ({
  activityKey: "gimnasio",
  weather: null,
  season: null,
  generatedAt: "2026-07-10T00:00:00.000Z",
  items
});
const it1 = (text: string, over = {}) => ({ text, checked: false, source: "list" as const, ...over });

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Gimnasio",
  category: "general",
  description: "",
  priority: "medium",
  estimateMin: 60,
  dueDate: "2026-07-10",
  kind: "task",
  status: "pending",
  done: false,
  time: "18:00",
  checklist: checklist([it1("Agua"), it1("Celular")]),
  ...over
});

const run = (tasks: Task[], nowMinutes: number, extra: Partial<Parameters<typeof dueChecklistReminders>[0]> = {}) =>
  dueChecklistReminders({ tasks, today: "2026-07-10", nowMinutes, leadMin: 30, fired: new Set(), ...extra });

describe("preferencia del aviso", () => {
  it("lo que el usuario eligió manda; sin elección, el despistado lo tiene activo", () => {
    expect(reminderEnabled("on", false)).toBe(true);
    expect(reminderEnabled("off", true)).toBe(false);
    expect(reminderEnabled(null, true)).toBe(true);
    expect(reminderEnabled(null, false)).toBe(false);
  });

  it("se ofrece solo a quien no eligió y no es despistado", () => {
    expect(shouldOffer(null, false)).toBe(true);
    expect(shouldOffer(null, true)).toBe(false);
    expect(shouldOffer("off", false)).toBe(false);
    expect(shouldOffer("on", false)).toBe(false);
  });

  it("los minutos de anticipación válidos son 10, 30 y 60; lo demás, el default", () => {
    expect(readLead("10")).toBe(10);
    expect(readLead(60)).toBe(60);
    expect(readLead("45")).toBe(DEFAULT_LEAD_MIN);
    expect(readLead(null)).toBe(DEFAULT_LEAD_MIN);
    expect(DEFAULT_LEAD_MIN).toBe(30);
  });
});

describe("pendingItems", () => {
  it("lista lo que falta llevar: sin lo tildado ni lo sacado", () => {
    const list = checklist([it1("Agua", { checked: true }), it1("Celular"), it1("Toalla", { removed: true })]);
    expect(pendingItems(list)).toEqual(["Celular"]);
    expect(pendingItems(null)).toEqual([]);
  });
});

describe("dueChecklistReminders", () => {
  it("avisa desde 30 minutos antes hasta la hora", () => {
    expect(run([task()], 17 * 60 + 29)).toHaveLength(0);
    expect(run([task()], 17 * 60 + 30)).toHaveLength(1);
    expect(run([task()], 17 * 60 + 59)).toHaveLength(1);
    expect(run([task()], 18 * 60)).toHaveLength(0);
  });

  it("respeta la anticipación elegida", () => {
    expect(run([task()], 17 * 60, { leadMin: 60 })).toHaveLength(1);
    expect(run([task()], 17 * 60, { leadMin: 10 })).toHaveLength(0);
  });

  it("no avisa lo que ya se avisó", () => {
    expect(run([task()], 17 * 60 + 40, { fired: new Set(["t1"]) })).toHaveLength(0);
  });

  it("solo hoy, con hora, pendientes y con algo para llevar", () => {
    const at = 17 * 60 + 40;
    expect(run([task({ dueDate: "2026-07-11" })], at)).toHaveLength(0);
    expect(run([task({ time: undefined })], at)).toHaveLength(0);
    expect(run([task({ done: true, status: "done" })], at)).toHaveLength(0);
    expect(run([task({ status: "skipped" })], at)).toHaveLength(0);
    expect(run([task({ checklist: undefined })], at)).toHaveLength(0);
    expect(run([task({ checklist: checklist([it1("Agua", { checked: true })]) })], at)).toHaveLength(0);
  });
});
