import type { Season } from "@/lib/season";
import { normalizeText } from "@/lib/text-normalize";

/**
 * La lógica de las checklists de "no te olvides": qué ítems entran hoy, cómo cambia el
 * estado de una ocurrencia y qué se aprende al terminarla. Pura: sin base, sin red y sin
 * reloj (`now` entra por parámetro). Ver "Etapa 5" en docs/roadmap.md.
 */

export type Weather = "rain" | "cold" | "hot";
export type { Season };

/** Un ítem de la lista guardada de una actividad. */
export interface ChecklistItem {
  text: string;
  uses: number;
  /** Veces SEGUIDAS que el usuario lo sacó. Usarlo de nuevo lo vuelve a 0. */
  skips: number;
  lastUsedAt: string | null;
  /** Solo aplica en esa época del año. */
  season?: Season | null;
  /** Solo aplica con ese clima. */
  weather?: Weather | null;
}

export type SnapshotSource = "list" | "season" | "weather" | "user";

/** Un ítem en la checklist de una ocurrencia concreta. */
export interface SnapshotItem {
  text: string;
  checked: boolean;
  /** El usuario dijo "hoy no lo necesito". Se guarda para poder deshacerlo y para aprender. */
  removed?: boolean;
  source: SnapshotSource;
  /** Ya se sumó a la lista al agregarlo: al completar no se cuenta otra vez. */
  counted?: boolean;
}

/** La checklist de una ocurrencia (`tasks.checklist`). */
export interface TaskChecklist {
  activityKey: string;
  items: SnapshotItem[];
  weather: Weather | null;
  season: Season | null;
  generatedAt: string;
  /** Cuándo se aprendió de esta ocurrencia. Sin esto, tildar/destildar "hecho" contaría dos veces. */
  learnedAt?: string;
}

export const MAX_ITEMS_SHOWN = 10;
export const MAX_ITEMS_STORED = 30;
export const ITEM_MAX_LENGTH = 60;
/** Sacarlo tantas veces seguidas lo borra de la lista. */
export const REMOVE_AFTER_SKIPS = 3;

const SEASONS: Season[] = ["summer", "winter"];
const WEATHERS: Weather[] = ["rain", "cold", "hot"];

export function cleanItemText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, ITEM_MAX_LENGTH);
}

/** Cómo se compara un ítem con otro: "Campera", "campera " y "CAMPÉRA" son el mismo. */
export function itemKey(text: string): string {
  return normalizeText(text);
}

/** Lee ítems de la base o de la IA sin confiar en ellos: lo inválido se descarta, no rompe. */
export function sanitizeItems(raw: unknown, limit = MAX_ITEMS_STORED): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;
    const text = cleanItemText(source.text);
    const key = itemKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
    items.push({
      text,
      uses: count(source.uses),
      skips: count(source.skips),
      lastUsedAt: typeof source.lastUsedAt === "string" ? source.lastUsedAt : null,
      season: SEASONS.includes(source.season as Season) ? (source.season as Season) : null,
      weather: WEATHERS.includes(source.weather as Weather) ? (source.weather as Weather) : null
    });
    if (items.length >= limit) break;
  }
  return items;
}

const score = (item: ChecklistItem) => item.uses * 2 - item.skips * 3;

function byRelevance(a: ChecklistItem, b: ChecklistItem): number {
  return (
    score(b) - score(a) ||
    (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") ||
    a.text.localeCompare(b.text)
  );
}

export type SelectContext = { season: Season | null; weather: Weather | null };

/**
 * Los ítems de hoy: los más usados sin condición, más los de época y de clima que aplican
 * ese día. Un ítem con condición fuera de contexto no entra (la campera en pleno verano), y
 * uno que el usuario sacó `REMOVE_AFTER_SKIPS` veces seguidas tampoco. Sin clima conocido,
 * los ítems de clima no entran: no se adivina.
 */
export function selectItems(
  list: readonly ChecklistItem[],
  context: SelectContext,
  limit: number = MAX_ITEMS_SHOWN
): Array<{ item: ChecklistItem; source: SnapshotSource }> {
  const picked: Array<{ item: ChecklistItem; source: SnapshotSource }> = [];
  for (const item of [...list].sort(byRelevance)) {
    if (item.skips >= REMOVE_AFTER_SKIPS) continue;
    if (item.season && item.season !== context.season) continue;
    if (item.weather && item.weather !== context.weather) continue;
    picked.push({ item, source: item.weather ? "weather" : item.season ? "season" : "list" });
  }
  // Los condicionales que aplican hoy van primero: son los que más se olvidan.
  picked.sort((a, b) => Number(b.source !== "list") - Number(a.source !== "list"));
  return picked.slice(0, limit);
}

export function buildSnapshot(
  activityKey: string,
  list: readonly ChecklistItem[],
  context: SelectContext,
  now: Date
): TaskChecklist {
  return {
    activityKey,
    weather: context.weather,
    season: context.season,
    generatedAt: now.toISOString(),
    items: selectItems(list, context).map(({ item, source }) => ({ text: item.text, checked: false, source }))
  };
}

/** Lee `tasks.checklist` sin confiar en la forma. */
export function readTaskChecklist(raw: unknown): TaskChecklist | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.activityKey !== "string" || !Array.isArray(value.items)) return null;
  const seen = new Set<string>();
  const items: SnapshotItem[] = [];
  for (const entry of value.items) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;
    const text = cleanItemText(source.text);
    if (!text || seen.has(itemKey(text))) continue;
    seen.add(itemKey(text));
    items.push({
      text,
      checked: source.checked === true,
      ...(source.removed === true ? { removed: true } : {}),
      source: (["list", "season", "weather", "user"] as const).includes(source.source as SnapshotSource)
        ? (source.source as SnapshotSource)
        : "list",
      ...(source.counted === true ? { counted: true } : {})
    });
  }
  return {
    activityKey: value.activityKey,
    items: items.slice(0, MAX_ITEMS_STORED),
    weather: WEATHERS.includes(value.weather as Weather) ? (value.weather as Weather) : null,
    season: SEASONS.includes(value.season as Season) ? (value.season as Season) : null,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : new Date(0).toISOString(),
    ...(typeof value.learnedAt === "string" ? { learnedAt: value.learnedAt } : {})
  };
}

// ---------------------------------------------------------------------------
// Editar la checklist de una ocurrencia
// ---------------------------------------------------------------------------

export type ChecklistOp =
  | { op: "toggle"; text: string }
  | { op: "remove"; text: string }
  | { op: "restore"; text: string }
  | { op: "add"; text: string };

export type OpResult =
  | { ok: true; checklist: TaskChecklist; /** Ítem nuevo para la lista guardada. */ added?: string }
  | { ok: false; reason: "empty" | "not_found" | "limit" };

/**
 * Aplica una edición a la checklist de una ocurrencia. `add` de un ítem que el usuario había
 * sacado lo trae de vuelta en vez de duplicarlo. No muta el original.
 */
export function applyOp(checklist: TaskChecklist, change: ChecklistOp): OpResult {
  const text = cleanItemText(change.text);
  if (!text) return { ok: false, reason: "empty" };
  const key = itemKey(text);
  const index = checklist.items.findIndex((item) => itemKey(item.text) === key);
  const items = checklist.items.map((item) => ({ ...item }));

  if (change.op === "add") {
    if (index >= 0) {
      const existing = items[index];
      if (!existing.removed) return { ok: true, checklist: { ...checklist, items } };
      existing.removed = false;
      return { ok: true, checklist: { ...checklist, items }, added: existing.text };
    }
    if (items.length >= MAX_ITEMS_STORED) return { ok: false, reason: "limit" };
    items.push({ text, checked: false, source: "user", counted: true });
    return { ok: true, checklist: { ...checklist, items }, added: text };
  }

  if (index < 0) return { ok: false, reason: "not_found" };
  const item = items[index];
  if (change.op === "toggle") item.checked = !item.checked;
  if (change.op === "remove") {
    item.removed = true;
    item.checked = false;
  }
  if (change.op === "restore") item.removed = false;
  return { ok: true, checklist: { ...checklist, items } };
}

// ---------------------------------------------------------------------------
// Aprender
// ---------------------------------------------------------------------------

/** Agrega un ítem a la lista guardada, o suma un uso si ya estaba. Devuelve una lista nueva. */
export function addItemToList(list: readonly ChecklistItem[], text: string, now: Date): ChecklistItem[] {
  const clean = cleanItemText(text);
  if (!clean) return [...list];
  const key = itemKey(clean);
  const stamp = now.toISOString();
  const next = list.map((item) => ({ ...item }));
  const found = next.find((item) => itemKey(item.text) === key);
  if (found) {
    found.uses += 1;
    found.skips = 0;
    found.lastUsedAt = stamp;
  } else {
    next.push({ text: clean, uses: 1, skips: 0, lastUsedAt: stamp, season: null, weather: null });
  }
  return trim(next);
}

/**
 * Qué se aprende al completar una ocurrencia:
 *  - lo que quedó en la lista: `uses + 1`, `skips = 0`;
 *  - lo que el usuario sacó: `skips + 1`, y a las `REMOVE_AFTER_SKIPS` seguidas se borra;
 *  - lo que agregó a mano ya se contó al agregarlo (`counted`), no se suma dos veces.
 * Los ítems de la lista que hoy no entraron (otra época, otro clima) no se tocan.
 */
export function mergeLearning(
  list: readonly ChecklistItem[],
  checklist: TaskChecklist,
  now: Date
): ChecklistItem[] {
  const stamp = now.toISOString();
  const next = list.map((item) => ({ ...item }));

  for (const shown of checklist.items) {
    if (shown.counted) continue;
    const found = next.find((item) => itemKey(item.text) === itemKey(shown.text));
    if (shown.removed) {
      if (found) found.skips += 1;
      continue;
    }
    if (found) {
      found.uses += 1;
      found.skips = 0;
      found.lastUsedAt = stamp;
    } else {
      next.push({ text: shown.text, uses: 1, skips: 0, lastUsedAt: stamp, season: null, weather: null });
    }
  }

  return trim(next.filter((item) => item.skips < REMOVE_AFTER_SKIPS));
}

/** Si la lista se pasa del tope, se van los de peor puntaje. */
function trim(list: ChecklistItem[]): ChecklistItem[] {
  return list.length <= MAX_ITEMS_STORED ? list : [...list].sort(byRelevance).slice(0, MAX_ITEMS_STORED);
}
