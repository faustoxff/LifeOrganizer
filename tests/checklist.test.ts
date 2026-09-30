import { describe, expect, it } from "vitest";
import {
  addItemToList,
  applyOp,
  buildSnapshot,
  cleanItemText,
  itemKey,
  MAX_ITEMS_SHOWN,
  MAX_ITEMS_STORED,
  mergeLearning,
  readTaskChecklist,
  REMOVE_AFTER_SKIPS,
  sanitizeItems,
  selectItems,
  type ChecklistItem,
  type TaskChecklist
} from "@/lib/checklist";

const NOW = new Date("2026-07-10T09:00:00.000Z");

const item = (text: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  text,
  uses: 0,
  skips: 0,
  lastUsedAt: null,
  season: null,
  weather: null,
  ...over
});

const GYM: ChecklistItem[] = [
  item("Agua", { uses: 9 }),
  item("Celular", { uses: 8 }),
  item("Auriculares", { uses: 6 }),
  item("Toalla", { uses: 2 }),
  item("Campera", { uses: 1, season: "winter" }),
  item("Paraguas", { weather: "rain" }),
  item("Protector solar", { season: "summer" }),
  item("Gorra", { weather: "hot" }),
  item("Buzo", { weather: "cold" })
];

const texts = (list: Array<{ item: ChecklistItem }>) => list.map((p) => p.item.text);

describe("texto de un ítem", () => {
  it("se limpia y se compara sin acentos ni mayúsculas", () => {
    expect(cleanItemText("  Campera \n abrigada ")).toBe("Campera abrigada");
    expect(cleanItemText("x".repeat(100))).toHaveLength(60);
    expect(cleanItemText(5)).toBe("");
    expect(itemKey("CAMPÉRA ")).toBe(itemKey("campera"));
  });
});

describe("sanitizeItems", () => {
  it("descarta lo inválido y los duplicados, y normaliza los contadores", () => {
    const items = sanitizeItems([
      { text: "Agua", uses: 3, skips: 1, lastUsedAt: "2026-07-01T00:00:00Z" },
      { text: "agua" },
      { text: "" },
      { text: "Campera", season: "winter", weather: "nieve" },
      { text: "Gorra", weather: "hot", uses: -4, skips: "x" },
      null,
      "texto suelto",
      7
    ]);
    expect(items.map((i) => i.text)).toEqual(["Agua", "Campera", "Gorra"]);
    expect(items[0]).toMatchObject({ uses: 3, skips: 1 });
    expect(items[1]).toMatchObject({ season: "winter", weather: null });
    expect(items[2]).toMatchObject({ weather: "hot", uses: 0, skips: 0 });
  });

  it("no es una lista: vacío", () => {
    expect(sanitizeItems(null)).toEqual([]);
    expect(sanitizeItems({ text: "x" })).toEqual([]);
  });

  it("respeta el tope", () => {
    const many = Array.from({ length: 50 }, (_, n) => ({ text: `Ítem ${n}` }));
    expect(sanitizeItems(many)).toHaveLength(MAX_ITEMS_STORED);
  });
});

describe("selectItems: temporada y clima", () => {
  it("en invierno con lluvia entran la campera y el paraguas, no lo del verano ni del calor", () => {
    const picked = texts(selectItems(GYM, { season: "winter", weather: "rain" }));
    expect(picked).toContain("Campera");
    expect(picked).toContain("Paraguas");
    expect(picked).toContain("Agua");
    expect(picked).not.toContain("Protector solar");
    expect(picked).not.toContain("Gorra");
    expect(picked).not.toContain("Buzo");
  });

  it("en verano con calor entran el protector y la gorra, no la campera", () => {
    const picked = texts(selectItems(GYM, { season: "summer", weather: "hot" }));
    expect(picked).toContain("Protector solar");
    expect(picked).toContain("Gorra");
    expect(picked).not.toContain("Campera");
    expect(picked).not.toContain("Paraguas");
  });

  it("sin clima conocido no entra ningún ítem de clima (no se adivina)", () => {
    const picked = texts(selectItems(GYM, { season: "winter", weather: null }));
    expect(picked).not.toContain("Paraguas");
    expect(picked).not.toContain("Buzo");
    expect(picked).toContain("Campera");
  });

  it("en una estación de paso, solo los ítems sin condición (y los de clima que apliquen)", () => {
    expect(texts(selectItems(GYM, { season: null, weather: null }))).toEqual(["Agua", "Celular", "Auriculares", "Toalla"]);
    expect(texts(selectItems(GYM, { season: null, weather: "cold" }))).toContain("Buzo");
  });

  it("los condicionales que aplican hoy van primero", () => {
    const picked = selectItems(GYM, { season: "winter", weather: "rain" });
    expect(picked[0].source).not.toBe("list");
    expect(picked.find((p) => p.item.text === "Campera")?.source).toBe("season");
    expect(picked.find((p) => p.item.text === "Paraguas")?.source).toBe("weather");
    expect(picked.find((p) => p.item.text === "Agua")?.source).toBe("list");
  });

  it("ordena por uso: el más usado antes", () => {
    const base = texts(selectItems(GYM, { season: null, weather: null }));
    expect(base).toEqual(["Agua", "Celular", "Auriculares", "Toalla"]);
  });

  it("un ítem que se sacó tres veces seguidas ya no entra; con dos, baja pero entra", () => {
    const list = [item("Agua", { uses: 5 }), item("Reloj", { uses: 5, skips: 2 }), item("Llaves", { uses: 9, skips: REMOVE_AFTER_SKIPS })];
    const picked = texts(selectItems(list, { season: null, weather: null }));
    expect(picked).toEqual(["Agua", "Reloj"]);
  });

  it("respeta el máximo de ítems", () => {
    const list = Array.from({ length: 25 }, (_, n) => item(`Ítem ${n}`, { uses: n }));
    const picked = selectItems(list, { season: null, weather: null });
    expect(picked).toHaveLength(MAX_ITEMS_SHOWN);
    expect(picked[0].item.text).toBe("Ítem 24");
  });

  it("un ítem con época Y clima necesita las dos", () => {
    const list = [item("Campera impermeable", { season: "winter", weather: "rain" })];
    expect(selectItems(list, { season: "winter", weather: "rain" })).toHaveLength(1);
    expect(selectItems(list, { season: "winter", weather: null })).toHaveLength(0);
    expect(selectItems(list, { season: "summer", weather: "rain" })).toHaveLength(0);
  });

  it("no muta la lista", () => {
    const copy = JSON.stringify(GYM);
    selectItems(GYM, { season: "winter", weather: "rain" });
    expect(JSON.stringify(GYM)).toBe(copy);
  });
});

describe("buildSnapshot", () => {
  it("arma la lista del día, sin tildes, con el contexto que se usó", () => {
    const snapshot = buildSnapshot("gimnasio", GYM, { season: "winter", weather: "rain" }, NOW);
    expect(snapshot).toMatchObject({ activityKey: "gimnasio", weather: "rain", season: "winter", generatedAt: NOW.toISOString() });
    expect(snapshot.items.every((i) => !i.checked && !i.removed)).toBe(true);
    expect(snapshot.items.map((i) => i.text)).toContain("Paraguas");
  });
});

describe("readTaskChecklist", () => {
  it("no confía en la forma", () => {
    expect(readTaskChecklist(null)).toBeNull();
    expect(readTaskChecklist({ items: [] })).toBeNull();
    expect(readTaskChecklist({ activityKey: "gimnasio", items: "x" })).toBeNull();
    const read = readTaskChecklist({
      activityKey: "gimnasio",
      weather: "nieve",
      items: [{ text: "Agua", checked: true, source: "raro" }, { text: "agua" }, { text: "" }, 3]
    })!;
    expect(read.weather).toBeNull();
    expect(read.items).toEqual([{ text: "Agua", checked: true, source: "list" }]);
  });
});

describe("applyOp", () => {
  const base = (): TaskChecklist => ({
    activityKey: "gimnasio",
    weather: null,
    season: null,
    generatedAt: NOW.toISOString(),
    items: [
      { text: "Agua", checked: false, source: "list" },
      { text: "Celular", checked: true, source: "list" }
    ]
  });

  it("tilda y destilda", () => {
    const a = applyOp(base(), { op: "toggle", text: "agua" });
    expect(a.ok && a.checklist.items[0].checked).toBe(true);
    const b = applyOp(base(), { op: "toggle", text: "Celular" });
    expect(b.ok && b.checklist.items[1].checked).toBe(false);
  });

  it("sacar un ítem lo marca y lo destilda; restaurar lo devuelve", () => {
    const removed = applyOp(base(), { op: "remove", text: "Celular" });
    expect(removed.ok && removed.checklist.items[1]).toMatchObject({ removed: true, checked: false });
    if (!removed.ok) throw new Error("no ok");
    const back = applyOp(removed.checklist, { op: "restore", text: "Celular" });
    expect(back.ok && back.checklist.items[1].removed).toBe(false);
  });

  it("agregar suma un ítem del usuario, ya contado, y avisa que hay uno nuevo para la lista", () => {
    const result = applyOp(base(), { op: "add", text: "  Auriculares " });
    expect(result.ok && result.added).toBe("Auriculares");
    expect(result.ok && result.checklist.items[2]).toEqual({ text: "Auriculares", checked: false, source: "user", counted: true });
  });

  it("agregar algo que ya está no lo duplica; si estaba sacado, lo trae de vuelta", () => {
    const dup = applyOp(base(), { op: "add", text: "AGUA" });
    expect(dup.ok && dup.checklist.items).toHaveLength(2);
    expect(dup.ok && dup.added).toBeUndefined();

    const removed = applyOp(base(), { op: "remove", text: "Agua" });
    if (!removed.ok) throw new Error("no ok");
    const readded = applyOp(removed.checklist, { op: "add", text: "agua" });
    expect(readded.ok && readded.checklist.items).toHaveLength(2);
    expect(readded.ok && readded.checklist.items[0].removed).toBe(false);
    expect(readded.ok && readded.added).toBe("Agua");
  });

  it("errores: vacío, inexistente, sin lugar", () => {
    expect(applyOp(base(), { op: "add", text: "   " })).toEqual({ ok: false, reason: "empty" });
    expect(applyOp(base(), { op: "toggle", text: "Paraguas" })).toEqual({ ok: false, reason: "not_found" });
    const full = base();
    full.items = Array.from({ length: MAX_ITEMS_STORED }, (_, n) => ({ text: `Ítem ${n}`, checked: false, source: "list" as const }));
    expect(applyOp(full, { op: "add", text: "Uno más" })).toEqual({ ok: false, reason: "limit" });
  });

  it("no muta el original", () => {
    const original = base();
    const copy = JSON.stringify(original);
    applyOp(original, { op: "toggle", text: "Agua" });
    applyOp(original, { op: "add", text: "Nuevo" });
    expect(JSON.stringify(original)).toBe(copy);
  });
});

describe("addItemToList", () => {
  it("un ítem nuevo entra con un uso", () => {
    const list = addItemToList([item("Agua", { uses: 3 })], "Auriculares", NOW);
    expect(list[1]).toMatchObject({ text: "Auriculares", uses: 1, skips: 0, lastUsedAt: NOW.toISOString() });
  });

  it("uno que ya estaba suma un uso y borra sus 'sacados'", () => {
    const list = addItemToList([item("Agua", { uses: 3, skips: 2 })], "agua", NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ uses: 4, skips: 0 });
  });

  it("un texto vacío no cambia nada", () => {
    expect(addItemToList([item("Agua")], "  ", NOW)).toHaveLength(1);
  });
});

describe("mergeLearning: aprender al completar", () => {
  const snapshot = (items: TaskChecklist["items"]): TaskChecklist => ({
    activityKey: "gimnasio",
    weather: "rain",
    season: "winter",
    generatedAt: NOW.toISOString(),
    items
  });
  const shown = (text: string, over: Partial<TaskChecklist["items"][number]> = {}) => ({
    text,
    checked: false,
    source: "list" as const,
    ...over
  });

  it("lo que quedó suma un uso y borra los 'sacados'", () => {
    const list = mergeLearning([item("Agua", { uses: 4, skips: 2 })], snapshot([shown("Agua", { checked: true })]), NOW);
    expect(list[0]).toMatchObject({ uses: 5, skips: 0, lastUsedAt: NOW.toISOString() });
  });

  it("lo que el usuario sacó suma un 'sacado' pero no baja los usos", () => {
    const list = mergeLearning([item("Toalla", { uses: 4 })], snapshot([shown("Toalla", { removed: true })]), NOW);
    expect(list[0]).toMatchObject({ uses: 4, skips: 1 });
  });

  it("sacarlo tres veces seguidas lo borra de la lista", () => {
    let list = [item("Reloj", { uses: 6 })];
    for (let time = 1; time <= REMOVE_AFTER_SKIPS; time += 1) {
      list = mergeLearning(list, snapshot([shown("Reloj", { removed: true })]), NOW);
      expect(list.some((i) => i.text === "Reloj")).toBe(time < REMOVE_AFTER_SKIPS);
    }
  });

  it("usarlo entre medio corta la racha de 'sacados'", () => {
    let list = [item("Reloj", { uses: 6 })];
    list = mergeLearning(list, snapshot([shown("Reloj", { removed: true })]), NOW);
    list = mergeLearning(list, snapshot([shown("Reloj", { removed: true })]), NOW);
    list = mergeLearning(list, snapshot([shown("Reloj")]), NOW);
    list = mergeLearning(list, snapshot([shown("Reloj", { removed: true })]), NOW);
    expect(list.find((i) => i.text === "Reloj")).toMatchObject({ skips: 1 });
  });

  it("un ítem que el usuario agregó y ya se contó al agregarlo no se cuenta dos veces", () => {
    const afterAdd = addItemToList([], "Auriculares", NOW);
    const list = mergeLearning(afterAdd, snapshot([shown("Auriculares", { source: "user", counted: true })]), NOW);
    expect(list[0].uses).toBe(1);
  });

  it("un ítem del snapshot que no está en la lista entra con un uso", () => {
    const list = mergeLearning([], snapshot([shown("Botella")]), NOW);
    expect(list).toEqual([expect.objectContaining({ text: "Botella", uses: 1 })]);
  });

  it("un ítem sacado que no está en la lista no aparece de la nada", () => {
    expect(mergeLearning([], snapshot([shown("Fantasma", { removed: true })]), NOW)).toEqual([]);
  });

  it("lo que hoy no entró (otra época, otro clima) queda intacto", () => {
    const list = mergeLearning(GYM, snapshot([shown("Agua")]), NOW);
    expect(list.find((i) => i.text === "Protector solar")).toEqual(GYM.find((i) => i.text === "Protector solar"));
    expect(list.find((i) => i.text === "Gorra")).toEqual(GYM.find((i) => i.text === "Gorra"));
    expect(list.find((i) => i.text === "Agua")?.uses).toBe(10);
  });

  it("las comparaciones ignoran mayúsculas y acentos", () => {
    const list = mergeLearning([item("Cámara", { uses: 1 })], snapshot([shown("camara")]), NOW);
    expect(list).toHaveLength(1);
    expect(list[0].uses).toBe(2);
  });

  it("no muta la lista de entrada", () => {
    const original = [item("Agua", { uses: 1 })];
    const copy = JSON.stringify(original);
    mergeLearning(original, snapshot([shown("Agua", { removed: true })]), NOW);
    expect(JSON.stringify(original)).toBe(copy);
  });

  it("la lista guardada tiene tope: se van los de peor puntaje", () => {
    const big = Array.from({ length: MAX_ITEMS_STORED }, (_, n) => item(`Viejo ${n}`, { uses: 5 }));
    const list = mergeLearning(big, snapshot([shown("Nuevo")]), NOW);
    expect(list).toHaveLength(MAX_ITEMS_STORED);
    expect(list.some((i) => i.text === "Nuevo")).toBe(false); // uses 1 pierde contra los de 5
  });

  it("un ciclo completo: la lista de la próxima vez refleja lo aprendido", () => {
    let list: ChecklistItem[] = [item("Agua"), item("Celular"), item("Toalla"), item("Candado")];
    for (let round = 0; round < 3; round += 1) {
      const snap = buildSnapshot("gimnasio", list, { season: null, weather: null }, NOW);
      const edited = snap.items.map((i) => (i.text === "Candado" ? { ...i, removed: true } : i));
      list = mergeLearning(list, { ...snap, items: edited }, NOW);
    }
    const next = texts(selectItems(list, { season: null, weather: null }));
    expect(next).toEqual(expect.arrayContaining(["Agua", "Celular", "Toalla"]));
    expect(next).not.toContain("Candado");
  });
});
