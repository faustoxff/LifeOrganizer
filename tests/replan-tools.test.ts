import { describe, expect, it, vi } from "vitest";
import { executeTool, type PinCandidate, type ReplanPort, type PinPort, type ToolContext } from "@/lib/milo-tools";

const call = async (ctx: Partial<ToolContext>, name: string, args: Record<string, unknown> = {}) => {
  const out = await executeTool({ id: "c", name, arguments: JSON.stringify(args) }, { today: "2026-09-30", now: new Date("2026-09-30T15:00:00Z"), load: vi.fn(), ...ctx } as ToolContext);
  return { out, body: JSON.parse(out.content) };
};

describe("replan_now", () => {
  const port = (moved: { title: string; from: string; to: string }[] = [], conflicts: { title: string; dueDate: string }[] = []) => {
    const run = vi.fn(async () => ({ moved, conflicts }));
    return { replan: { run } as ReplanPort, run };
  };

  it("hace el reacomodo y devuelve qué se movió; avisa al cliente que recargue", async () => {
    const { replan, run } = port([{ title: "Informe", from: "2026-09-29", to: "2026-10-01" }]);
    const { out, body } = await call({ replan }, "replan_now");
    expect(run).toHaveBeenCalledWith({ skipToday: false });
    expect(body).toMatchObject({ ok: true, movedCount: 1, moved: [{ title: "Informe", to: "2026-10-01" }] });
    expect(body.note).toMatch(/fechas límite no cambiaron/);
    expect(out.effect).toEqual({ tasksChanged: true });
  });

  it("'no llegué a nada hoy': skipToday", async () => {
    const { replan, run } = port();
    await call({ replan }, "replan_now", { skipToday: true });
    expect(run).toHaveBeenCalledWith({ skipToday: true });
  });

  it("si no había nada atrasado, no inventa cambios ni pide recargar", async () => {
    const { out, body } = await call(port().replan ? { replan: port().replan } : {}, "replan_now");
    expect(body.movedCount).toBe(0);
    expect(body.note).toMatch(/nada atrasado/);
    expect(out.effect).toBeUndefined();
  });

  it("informa los conflictos con la salida que se ofrece", async () => {
    const { replan } = port([], [{ title: "TP", dueDate: "2026-10-02" }]);
    const { body } = await call({ replan }, "replan_now");
    expect(body.conflicts).toEqual([{ title: "TP", dueDate: "2026-10-02" }]);
    expect(body.conflictNote).toMatch(/correr la fecha|minutos por día/);
  });

  it("no lista más de 10 movimientos", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ title: `t${i}`, from: "2026-09-29", to: "2026-10-01" }));
    const { body } = await call({ replan: port(many).replan }, "replan_now");
    expect(body.moved).toHaveLength(10);
    expect(body.andMore).toBe(4);
  });

  it("valida el argumento y falla con gracia sin puerto", async () => {
    expect((await call({ replan: port().replan }, "replan_now", { skipToday: "yes" })).out.isError).toBe(true);
    expect((await call({}, "replan_now")).out.isError).toBe(true);
  });

  it("un userId por argumento no llega a ningún lado", async () => {
    const { replan, run } = port();
    await call({ replan }, "replan_now", { userId: "otro" });
    expect(run).toHaveBeenCalledWith({ skipToday: false });
  });
});

describe("pin_task", () => {
  const tasks: PinCandidate[] = [{ id: "t1", title: "TP de álgebra", dueDate: "2026-10-01", pinned: false }];
  const port = (found: PinCandidate[] = tasks, setOk = true) => {
    const find = vi.fn(async () => found);
    const set = vi.fn(async () => setOk);
    return { pin: { find, set } as PinPort, find, set };
  };

  it("fija la tarea que encontró", async () => {
    const { pin, find, set } = port();
    const { out, body } = await call({ pin }, "pin_task", { title: "TP", dueDate: "2026-10-01" });
    expect(find).toHaveBeenCalledWith({ title: "TP", dueDate: "2026-10-01" });
    expect(set).toHaveBeenCalledWith("t1", true);
    expect(body).toMatchObject({ ok: true, pinned: true, title: "TP de álgebra" });
    expect(out.effect).toEqual({ tasksChanged: true });
  });

  it("pinned: false la suelta", async () => {
    const { pin, set } = port();
    const { body } = await call({ pin }, "pin_task", { title: "TP", pinned: false });
    expect(set).toHaveBeenCalledWith("t1", false);
    expect(body.pinned).toBe(false);
    expect(body.note).toMatch(/soltó/);
  });

  it("varias parecidas: no toca nada y devuelve las opciones", async () => {
    const { pin, set } = port([...tasks, { id: "t2", title: "TP de física", dueDate: "2026-10-03", pinned: false }]);
    const { out, body } = await call({ pin }, "pin_task", { title: "TP" });
    expect(set).not.toHaveBeenCalled();
    expect(body).toMatchObject({ found: 2, candidates: [{ title: "TP de álgebra" }, { title: "TP de física" }] });
    expect(out.effect).toBeUndefined();
  });

  it("ninguna: no toca nada", async () => {
    const { pin, set } = port([]);
    const { out, body } = await call({ pin }, "pin_task", { title: "cosa" });
    expect(body.found).toBe(0);
    expect(set).not.toHaveBeenCalled();
    expect(out.effect).toBeUndefined();
  });

  it("valida los argumentos", async () => {
    const { pin } = port();
    for (const args of [{}, { title: "x" }, { title: "TP", dueDate: "jueves" }, { title: "TP", pinned: "si" }, { title: "a".repeat(200) }]) {
      expect((await call({ pin }, "pin_task", args)).out.isError, JSON.stringify(args)).toBe(true);
    }
    expect((await call({}, "pin_task", { title: "TP" })).out.isError).toBe(true);
  });

  it("si no se pudo guardar, falla sin decir que quedó fijada", async () => {
    const { out } = await call({ pin: port(tasks, false).pin }, "pin_task", { title: "TP" });
    expect(out.isError).toBe(true);
  });
});
