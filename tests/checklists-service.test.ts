import { describe, expect, it, vi } from "vitest";
import type { ChecklistItem, TaskChecklist } from "@/lib/checklist";
import {
  detectActivities,
  dismissActivity,
  editChecklist,
  learnFromCompletion,
  resolveChecklist,
  type ChecklistContext,
  type ChecklistDeps,
  type ChecklistStore,
  type StoredListLike,
  type TaskRecord
} from "@/lib/checklists-service";
import type { UserFact } from "@/lib/user-facts";

/** Un store en memoria que imita el filtro por usuario y el orden de resolución de lib/checklists-storage.ts. */
function fakeStore(seed: { tasks?: Array<TaskRecord & { userId: string }>; lists?: Array<StoredListLike & { userId: string }>; facts?: Array<UserFact & { userId: string }>; location?: Record<string, { lat: number; lon: number }> } = {}) {
  const tasks = [...(seed.tasks ?? [])];
  const lists = [...(seed.lists ?? [])];
  const titles = new Map<string, string>();
  const calls = { saveList: 0 };
  const store: ChecklistStore = {
    async loadTask(userId, taskId) {
      const t = tasks.find((x) => x.id === taskId && x.userId === userId);
      return t ? { ...t } : null;
    },
    async saveTaskChecklist(userId, taskId, checklist) {
      const t = tasks.find((x) => x.id === taskId && x.userId === userId);
      if (t) t.checklist = checklist;
    },
    async loadList(userId, activityKey, seriesId) {
      const mine = lists.filter((l) => l.userId === userId && l.activityKey === activityKey);
      const found =
        mine.find((l) => seriesId && l.seriesId === seriesId) ??
        mine.find((l) => l.seriesId === null) ??
        (seriesId === null ? mine[0] : undefined);
      return found ? { ...found, items: found.items.map((i) => ({ ...i })) } : null;
    },
    async saveList(userId, activityKey, seriesId, items) {
      calls.saveList += 1;
      const existing = lists.find((l) => l.userId === userId && l.activityKey === activityKey && l.seriesId === seriesId);
      if (existing) existing.items = items.map((i) => ({ ...i }));
      else lists.push({ id: `l${lists.length}`, userId, activityKey, seriesId, items: items.map((i) => ({ ...i })) });
    },
    async loadTitleActivities(userId, list) {
      return new Map(list.filter((t) => titles.has(`${userId}|${t}`)).map((t) => [t, titles.get(`${userId}|${t}`)!]));
    },
    async saveTitleActivities(userId, entries) {
      for (const e of entries) titles.set(`${userId}|${e.title}`, e.activityKey);
    },
    async listFacts(userId) {
      return (seed.facts ?? []).filter((f) => f.userId === userId);
    },
    async getLocation(userId) {
      return seed.location?.[userId] ?? null;
    }
  };
  return { store, tasks, lists, titles, calls };
}

const NOW = new Date("2026-07-10T09:00:00.000Z");
const ctx = (over: Partial<ChecklistContext> = {}): ChecklistContext => ({
  userId: "u1",
  timeZone: "America/Argentina/Buenos_Aires",
  today: "2026-07-10",
  language: "es",
  ...over
});

const task = (over: Partial<TaskRecord & { userId: string }> = {}): TaskRecord & { userId: string } => ({
  userId: "u1",
  id: "t1",
  title: "Gimnasio",
  kind: "task",
  dueDate: "2026-07-10",
  seriesId: null,
  done: false,
  checklist: null,
  ...over
});

const gymItems = (): ChecklistItem[] => [
  { text: "Agua", uses: 0, skips: 0, lastUsedAt: null, season: null, weather: null },
  { text: "Celular", uses: 0, skips: 0, lastUsedAt: null, season: null, weather: null },
  { text: "Auriculares", uses: 0, skips: 0, lastUsedAt: null, season: null, weather: null },
  { text: "Campera", uses: 0, skips: 0, lastUsedAt: null, season: "winter", weather: null },
  { text: "Paraguas", uses: 0, skips: 0, lastUsedAt: null, season: null, weather: "rain" },
  { text: "Protector solar", uses: 0, skips: 0, lastUsedAt: null, season: "summer", weather: null }
];

function deps(store: ChecklistStore, over: Partial<ChecklistDeps> = {}): ChecklistDeps {
  return {
    store,
    now: () => NOW,
    gate: vi.fn(async () => true),
    generate: vi.fn(async () => gymItems()),
    classify: vi.fn(async (titles: string[]) => new Map(titles.map((t) => [t, null] as [string, string | null]))),
    weather: vi.fn(async () => "rain" as const),
    ...over
  };
}

describe("detectActivities", () => {
  it("las reglas resuelven lo conocido sin gastar IA", async () => {
    const { store } = fakeStore();
    const d = deps(store);
    const result = await detectActivities(ctx(), [
      { id: "a", title: "Gimnasio", kind: "task" },
      { id: "b", title: "Llamar al médico", kind: "reminder" },
      { id: "c", title: "Ir a la pileta", kind: "task" }
    ], d);
    expect(result).toEqual({ a: "gimnasio", b: null, c: "pileta" });
    // "Llamar al médico" no lo reconocen las reglas, así que sí se le pregunta a la IA, una vez y en lote.
    expect(d.classify).toHaveBeenCalledTimes(1);
    expect(d.classify).toHaveBeenCalledWith(["llamar al medico"]);
  });

  it("no le pregunta a la IA si las reglas lo resuelven todo", async () => {
    const { store } = fakeStore();
    const d = deps(store);
    await detectActivities(ctx(), [{ id: "a", title: "Gimnasio", kind: "task" }], d);
    expect(d.classify).not.toHaveBeenCalled();
    expect(d.gate).not.toHaveBeenCalled();
  });

  it("los proyectos no son actividades y no se mandan a la IA", async () => {
    const { store } = fakeStore();
    const d = deps(store);
    const result = await detectActivities(ctx(), [{ id: "p", title: "Gimnasio para la tesis", kind: "project" }], d);
    expect(result).toEqual({ p: null });
    expect(d.classify).not.toHaveBeenCalled();
  });

  it("clasifica en UNA llamada todos los títulos desconocidos, sin repetidos, y lo guarda", async () => {
    const { store, titles } = fakeStore();
    const d = deps(store, {
      classify: vi.fn(async () => new Map<string, string | null>([["clase de guitarra", "guitarra"], ["hacer las compras", null]]))
    });
    const result = await detectActivities(ctx(), [
      { id: "a", title: "Clase de guitarra", kind: "task" },
      { id: "b", title: "clase de guitarra!", kind: "task" },
      { id: "c", title: "Hacer las compras", kind: "task" }
    ], d);
    expect(d.classify).toHaveBeenCalledTimes(1);
    // 'clase' es del catálogo, así que las reglas ya lo reconocen: solo "hacer las compras" va a la IA.
    expect(result.a).toBe("facultad");
    expect(result.b).toBe("facultad");
    expect(titles.get("u1|hacer las compras")).toBe("");
  });

  it("un título ya clasificado no vuelve a la IA", async () => {
    const { store } = fakeStore();
    const d1 = deps(store, { classify: vi.fn(async () => new Map<string, string | null>([["peluqueria", "peluqueria"]])) });
    await detectActivities(ctx(), [{ id: "a", title: "Peluquería", kind: "task" }], d1);
    const d2 = deps(store);
    const second = await detectActivities(ctx(), [{ id: "z", title: "Peluquería", kind: "task" }], d2);
    expect(second.z).toBe("peluqueria");
    expect(d2.classify).not.toHaveBeenCalled();
  });

  it("lo que el usuario descartó le gana a las reglas", async () => {
    const f = fakeStore({ tasks: [task()] });
    await dismissActivity(ctx(), "t1", deps(f.store));
    const result = await detectActivities(ctx(), [{ id: "a", title: "Gimnasio", kind: "task" }], deps(f.store));
    expect(result.a).toBeNull();
  });

  it("sin cuota no llama a la IA y no guarda un 'no' falso", async () => {
    const { store, titles } = fakeStore();
    const d = deps(store, { gate: vi.fn(async () => false) });
    const result = await detectActivities(ctx(), [{ id: "a", title: "Peluquería", kind: "task" }], d);
    expect(result.a).toBeNull();
    expect(d.classify).not.toHaveBeenCalled();
    expect(titles.size).toBe(0);
  });

  it("si la IA falla, no rompe y no guarda nada", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, titles } = fakeStore();
    const d = deps(store, { classify: vi.fn(async () => { throw new Error("caída"); }) });
    const result = await detectActivities(ctx(), [{ id: "a", title: "Peluquería", kind: "task" }], d);
    expect(result.a).toBeNull();
    expect(titles.size).toBe(0);
    warn.mockRestore();
  });

  it("la caché es por usuario", async () => {
    const { store } = fakeStore();
    await detectActivities(ctx({ userId: "u1" }), [{ id: "a", title: "Peluquería", kind: "task" }], deps(store, { classify: vi.fn(async () => new Map<string, string | null>([["peluqueria", "peluqueria"]])) }));
    const d2 = deps(store);
    const other = await detectActivities(ctx({ userId: "u2" }), [{ id: "a", title: "Peluquería", kind: "task" }], d2);
    expect(d2.classify).toHaveBeenCalledTimes(1);
    expect(other.a).toBeNull();
  });
});

describe("resolveChecklist: primera vez", () => {
  it("genera la lista, la guarda y arma la de hoy con la época y el clima", async () => {
    const f = fakeStore({ tasks: [task()], location: { u1: { lat: -34.6, lon: -58.4 } } });
    const d = deps(f.store);
    const result = await resolveChecklist(ctx(), "t1", d);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // Julio en Buenos Aires es invierno; el clima que devolvió el fake es lluvia.
    expect(result.checklist).toMatchObject({ activityKey: "gimnasio", season: "winter", weather: "rain" });
    const texts = result.checklist.items.map((i) => i.text);
    expect(texts).toEqual(expect.arrayContaining(["Agua", "Celular", "Auriculares", "Campera", "Paraguas"]));
    expect(texts).not.toContain("Protector solar");
    expect(d.generate).toHaveBeenCalledTimes(1);
    expect(d.weather).toHaveBeenCalledWith({ lat: -34.6, lon: -58.4 }, "2026-07-10", 0);
    // Quedó guardada la lista de la actividad y el snapshot de la ocurrencia.
    expect(f.lists).toHaveLength(1);
    expect(f.tasks[0].checklist).toEqual(result.checklist);
  });

  it("le pasa a la IA los hechos relevantes y no todos", async () => {
    const fact = (key: string, value: string) => ({ userId: "u1", id: key, key, value, source: "stated" as const, confidence: 1, updatedAt: "2026-07-01T00:00:00Z" });
    const f = fakeStore({
      tasks: [task()],
      facts: [fact("es_despistado", "sí"), fact("deportes", "gimnasio y pádel"), fact("mascota", "un perro llamado Toby"), { ...fact("deportes", "otro usuario"), userId: "u2", id: "x" }]
    });
    const d = deps(f.store);
    await resolveChecklist(ctx(), "t1", d);
    const input = (d.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const keys = input.facts.map((x: UserFact) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["es_despistado", "deportes"]));
    expect(keys).not.toContain("mascota");
    expect(input.facts.map((x: UserFact) => x.value)).not.toContain("otro usuario");
    expect(input).toMatchObject({ activityKey: "gimnasio", season: "winter", language: "es" });
  });

  it("sin ubicación no consulta el clima y arma sin él", async () => {
    const f = fakeStore({ tasks: [task()] });
    const d = deps(f.store);
    const result = await resolveChecklist(ctx(), "t1", d);
    expect(d.weather).not.toHaveBeenCalled();
    expect(result.status === "ok" && result.checklist.weather).toBeNull();
    expect(result.status === "ok" && result.checklist.items.map((i) => i.text)).not.toContain("Paraguas");
  });

  it("la lista de la serie nace ligada a la serie", async () => {
    const f = fakeStore({ tasks: [task({ seriesId: "s1" })] });
    await resolveChecklist(ctx(), "t1", deps(f.store));
    expect(f.lists[0]).toMatchObject({ activityKey: "gimnasio", seriesId: "s1" });
  });

  it("es idempotente: si la ocurrencia ya tiene checklist, la devuelve sin gastar IA", async () => {
    const existing: TaskChecklist = { activityKey: "gimnasio", weather: null, season: null, generatedAt: NOW.toISOString(), items: [{ text: "Llaves", checked: true, source: "list" }] };
    const f = fakeStore({ tasks: [task({ checklist: existing })] });
    const d = deps(f.store);
    const result = await resolveChecklist(ctx(), "t1", d);
    expect(result).toEqual({ status: "ok", checklist: existing });
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("otra ocurrencia de la misma actividad reusa la lista: no vuelve a generar", async () => {
    const f = fakeStore({ tasks: [task(), task({ id: "t2", dueDate: "2026-07-12" })] });
    const d = deps(f.store);
    await resolveChecklist(ctx(), "t1", d);
    await resolveChecklist(ctx(), "t2", d);
    expect(d.generate).toHaveBeenCalledTimes(1);
  });

  it("una tarea suelta reusa la lista que nació ligada a una serie de la misma actividad", async () => {
    const f = fakeStore({ tasks: [task({ seriesId: "s1" }), task({ id: "t2", seriesId: null })] });
    const d = deps(f.store);
    await resolveChecklist(ctx(), "t1", d);
    await resolveChecklist(ctx(), "t2", d);
    expect(d.generate).toHaveBeenCalledTimes(1);
  });

  it("una serie no usa la lista de otra serie", async () => {
    const f = fakeStore({ tasks: [task({ seriesId: "s1" }), task({ id: "t2", seriesId: "s2" })] });
    const d = deps(f.store);
    await resolveChecklist(ctx(), "t1", d);
    await resolveChecklist(ctx(), "t2", d);
    expect(d.generate).toHaveBeenCalledTimes(2);
  });

  it("sin actividad, no hay checklist", async () => {
    const f = fakeStore({ tasks: [task({ title: "Hacer las compras" })] });
    expect(await resolveChecklist(ctx(), "t1", deps(f.store))).toEqual({ status: "no_activity" });
  });

  it("un proyecto no tiene checklist", async () => {
    const f = fakeStore({ tasks: [task({ kind: "project", title: "Gimnasio" })] });
    expect(await resolveChecklist(ctx(), "t1", deps(f.store))).toEqual({ status: "no_activity" });
  });

  it("una tarea de otro usuario no existe", async () => {
    const f = fakeStore({ tasks: [task({ userId: "u2" })] });
    const d = deps(f.store);
    expect(await resolveChecklist(ctx({ userId: "u1" }), "t1", d)).toEqual({ status: "no_task" });
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("sin cuota: checklist vacía, sin guardar nada, para que se reintente", async () => {
    const f = fakeStore({ tasks: [task()] });
    const d = deps(f.store, { gate: vi.fn(async () => false) });
    const result = await resolveChecklist(ctx(), "t1", d);
    expect(result).toMatchObject({ status: "ok", degraded: "limit" });
    expect(result.status === "ok" && result.checklist.items).toEqual([]);
    expect(d.generate).not.toHaveBeenCalled();
    expect(f.tasks[0].checklist).toBeNull();
    expect(f.lists).toHaveLength(0);
  });

  it("si la IA falla, igual: vacía, sin guardar, y se puede armar a mano", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeStore({ tasks: [task()] });
    const d = deps(f.store, { generate: vi.fn(async () => { throw new Error("mal JSON"); }) });
    const result = await resolveChecklist(ctx(), "t1", d);
    expect(result).toMatchObject({ status: "ok", degraded: "ai_failed" });
    expect(f.tasks[0].checklist).toBeNull();
    warn.mockRestore();
  });

  it("con una lista guardada no genera y no gasta cuota", async () => {
    const f = fakeStore({
      tasks: [task()],
      lists: [{ userId: "u1", id: "l", activityKey: "gimnasio", seriesId: null, items: [{ text: "Toalla", uses: 5, skips: 0, lastUsedAt: null, season: null, weather: null }] }]
    });
    const d = deps(f.store);
    const result = await resolveChecklist(ctx(), "t1", d);
    expect(result.status === "ok" && result.checklist.items.map((i) => i.text)).toEqual(["Toalla"]);
    expect(d.gate).not.toHaveBeenCalled();
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("no pide el clima de una fecha lejana", async () => {
    const f = fakeStore({ tasks: [task({ dueDate: "2026-07-30" })], location: { u1: { lat: 1, lon: 2 } } });
    const d = deps(f.store, { weather: vi.fn(async () => null) });
    await resolveChecklist(ctx(), "t1", d);
    expect(d.weather).toHaveBeenCalledWith({ lat: 1, lon: 2 }, "2026-07-30", 20);
  });
});

describe("editChecklist", () => {
  const withList = () =>
    fakeStore({
      tasks: [task()],
      lists: [{ userId: "u1", id: "l", activityKey: "gimnasio", seriesId: null, items: [{ text: "Agua", uses: 3, skips: 0, lastUsedAt: null, season: null, weather: null }] }]
    });

  it("tildar y sacar se guardan en la ocurrencia y no tocan la lista", async () => {
    const f = withList();
    const d = deps(f.store);
    await editChecklist(ctx(), "t1", { op: "toggle", text: "Agua" }, d);
    const removed = await editChecklist(ctx(), "t1", { op: "remove", text: "Agua" }, d);
    expect(removed.status).toBe("ok");
    expect(f.tasks[0].checklist?.items[0]).toMatchObject({ text: "Agua", removed: true, checked: false });
    expect(f.lists[0].items[0]).toMatchObject({ uses: 3, skips: 0 });
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("agregar un ítem lo suma a la lista guardada en el momento, con un uso", async () => {
    const f = withList();
    await editChecklist(ctx(), "t1", { op: "add", text: "Auriculares" }, deps(f.store));
    expect(f.lists[0].items.find((i) => i.text === "Auriculares")).toMatchObject({ uses: 1, skips: 0 });
    expect(f.tasks[0].checklist?.items.find((i) => i.text === "Auriculares")).toMatchObject({ source: "user", counted: true });
  });

  it("agregar un ítem que ya estaba en la lista suma un uso, sin duplicar", async () => {
    const f = withList();
    const d = deps(f.store);
    await editChecklist(ctx(), "t1", { op: "remove", text: "Agua" }, d);
    await editChecklist(ctx(), "t1", { op: "add", text: "agua" }, d);
    expect(f.lists[0].items.filter((i) => i.text.toLowerCase() === "agua")).toHaveLength(1);
    expect(f.lists[0].items[0].uses).toBe(4);
  });

  it("se puede armar a mano cuando no había lista ni IA", async () => {
    const f = fakeStore({ tasks: [task()] });
    const d = deps(f.store);
    const result = await editChecklist(ctx(), "t1", { op: "add", text: "Botella" }, d);
    expect(result.status).toBe("ok");
    expect(f.lists[0]).toMatchObject({ activityKey: "gimnasio", seriesId: null });
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("errores claros", async () => {
    const f = withList();
    const d = deps(f.store);
    expect(await editChecklist(ctx(), "t1", { op: "toggle", text: "Fantasma" }, d)).toEqual({ status: "invalid", reason: "not_found" });
    expect(await editChecklist(ctx(), "t1", { op: "add", text: "  " }, d)).toEqual({ status: "invalid", reason: "empty" });
    expect(await editChecklist(ctx(), "nope", { op: "add", text: "x" }, d)).toEqual({ status: "no_task" });
    const noActivity = fakeStore({ tasks: [task({ title: "Hacer las compras" })] });
    expect(await editChecklist(ctx(), "t1", { op: "add", text: "x" }, deps(noActivity.store))).toEqual({ status: "no_activity" });
  });

  it("no toca la tarea de otro usuario", async () => {
    const f = fakeStore({ tasks: [task({ userId: "u2" })] });
    expect(await editChecklist(ctx({ userId: "u1" }), "t1", { op: "add", text: "x" }, deps(f.store))).toEqual({ status: "no_task" });
    expect(f.tasks[0].checklist).toBeNull();
  });
});

describe("dismissActivity", () => {
  it("borra la checklist de esa tarea y el título no vuelve a ser actividad", async () => {
    const existing: TaskChecklist = { activityKey: "gimnasio", weather: null, season: null, generatedAt: NOW.toISOString(), items: [] };
    const f = fakeStore({ tasks: [task({ checklist: existing })] });
    expect(await dismissActivity(ctx(), "t1", deps(f.store))).toBe(true);
    expect(f.tasks[0].checklist).toBeNull();
    expect(f.titles.get("u1|gimnasio")).toBe("");
  });

  it("no descarta la tarea de otro usuario", async () => {
    const f = fakeStore({ tasks: [task({ userId: "u2" })] });
    expect(await dismissActivity(ctx({ userId: "u1" }), "t1", deps(f.store))).toBe(false);
    expect(f.titles.size).toBe(0);
  });
});

describe("learnFromCompletion", () => {
  const checklist = (): TaskChecklist => ({
    activityKey: "gimnasio",
    weather: null,
    season: null,
    generatedAt: NOW.toISOString(),
    items: [
      { text: "Agua", checked: true, source: "list" },
      { text: "Toalla", checked: false, source: "list", removed: true }
    ]
  });
  const list = (): StoredListLike & { userId: string } => ({
    userId: "u1",
    id: "l",
    activityKey: "gimnasio",
    seriesId: null,
    items: [
      { text: "Agua", uses: 2, skips: 1, lastUsedAt: null, season: null, weather: null },
      { text: "Toalla", uses: 2, skips: 0, lastUsedAt: null, season: null, weather: null }
    ]
  });

  it("suma un uso a lo que quedó, un 'sacado' a lo que se sacó, y marca la ocurrencia como aprendida", async () => {
    const f = fakeStore({ tasks: [task({ done: true, checklist: checklist() })], lists: [list()] });
    expect(await learnFromCompletion("u1", "t1", deps(f.store))).toBe(true);
    expect(f.lists[0].items).toEqual([
      expect.objectContaining({ text: "Agua", uses: 3, skips: 0 }),
      expect.objectContaining({ text: "Toalla", uses: 2, skips: 1 })
    ]);
    expect(f.tasks[0].checklist?.learnedAt).toBe(NOW.toISOString());
  });

  it("una sola vez por ocurrencia: completar, deshacer y completar no cuenta doble", async () => {
    const f = fakeStore({ tasks: [task({ done: true, checklist: checklist() })], lists: [list()] });
    const d = deps(f.store);
    await learnFromCompletion("u1", "t1", d);
    expect(await learnFromCompletion("u1", "t1", d)).toBe(false);
    expect(f.lists[0].items[0].uses).toBe(3);
  });

  it("no aprende de lo que no se completó", async () => {
    const f = fakeStore({ tasks: [task({ done: false, checklist: checklist() })], lists: [list()] });
    expect(await learnFromCompletion("u1", "t1", deps(f.store))).toBe(false);
    expect(f.calls.saveList).toBe(0);
  });

  it("ni de una tarea sin checklist", async () => {
    const f = fakeStore({ tasks: [task({ done: true })], lists: [list()] });
    expect(await learnFromCompletion("u1", "t1", deps(f.store))).toBe(false);
  });

  it("sacar tres veces seguidas borra el ítem de la lista guardada", async () => {
    const f = fakeStore({ tasks: [], lists: [list()] });
    for (let n = 0; n < 3; n += 1) {
      f.tasks.splice(0, f.tasks.length, task({ id: `o${n}`, done: true, checklist: checklist() }));
      await learnFromCompletion("u1", `o${n}`, deps(f.store));
    }
    expect(f.lists[0].items.map((i) => i.text)).not.toContain("Toalla");
    expect(f.lists[0].items.map((i) => i.text)).toContain("Agua");
  });

  it("no aprende con la tarea de otro usuario", async () => {
    const f = fakeStore({ tasks: [task({ userId: "u2", done: true, checklist: checklist() })], lists: [list()] });
    expect(await learnFromCompletion("u1", "t1", deps(f.store))).toBe(false);
  });
});
