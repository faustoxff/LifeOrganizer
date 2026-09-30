import { normalizeText } from "@/lib/text-normalize";

/**
 * Qué actividad es una tarea, para saber si tiene una checklist de "no te olvides".
 *
 * Reglas primero (gratis y sin red), en varios idiomas. Lo que las reglas no reconocen lo
 * clasifica la IA en un lote (lib/checklist-ai.ts) y el resultado se guarda por título.
 * Todo texto se compara normalizado: minúsculas, sin acentos.
 */

export const ACTIVITY_KEYS = [
  "gimnasio",
  "correr",
  "deporte",
  "pileta",
  "playa",
  "yoga",
  "facultad",
  "trabajo",
  "viaje",
  "medico"
] as const;

export type CatalogActivity = (typeof ACTIVITY_KEYS)[number];

const w = (...stems: string[]) => new RegExp(`\\b(?:${stems.join("|")})`);

// El orden importa: lo más específico primero. "natación" tiene que ganarle a "deporte".
const RULES: Array<[CatalogActivity, RegExp]> = [
  ["pileta", w("pileta", "natacion", "nadar", "piscina", "swim", "nager", "schwimmen", "nuoto")],
  ["playa", w("playa", "beach", "praia", "plage", "strand\\b", "spiaggia")],
  ["viaje", w("viaje", "viajar", "vuelo", "aeropuerto", "valija", "equipaje", "trip\\b", "flight", "airport", "travel", "luggage", "viagem", "voo\\b", "voyage", "reise\\b", "flug\\b", "viaggio")],
  ["gimnasio", w("gimnasio", "gym\\b", "gimnasia", "entrenar", "entrenamiento", "crossfit", "musculacion", "pesas", "workout", "training", "fitness", "spinning", "academia\\b", "muscu", "fitnessstudio", "palestra")],
  ["correr", w("correr", "running", "trotar", "maraton", "jogging", "corrida", "salir a correr", "laufen", "courir", "footing")],
  ["yoga", w("yoga", "pilates")],
  ["deporte", w("padel", "tenis", "futbol", "basquet", "basket", "voley", "hockey", "rugby", "soccer", "football", "tennis", "volleyball", "handball", "golf", "futsal", "partido de")],
  ["facultad", w("facultad", "universidad", "cursar", "cursada", "clase\\b", "clases\\b", "university", "lecture", "college", "faculdade", "aula\\b", "vorlesung", "universite", "universita")],
  ["trabajo", w("oficina", "office\\b", "coworking", "ir a trabajar", "ir al trabajo", "go to work", "commute")],
  ["medico", w("medico", "doctor", "dentista", "odontolog", "clinica", "hospital", "checkup", "check-up", "dentist", "arzt", "zahnarzt", "dottore", "medecin", "turno medico")]
];

// Un mandado no es ir a la actividad: "llamar al médico" no necesita llevar nada.
const ERRAND = /^(?:llamar|llama|call|pedir|sacar|reservar|comprar|pagar|renovar|mandar|enviar|cancelar|buy|book|pay|send|cancel|ligar|appeler|anrufen|chiamare)\b/;

/** El título tal como se compara y se guarda en la caché de actividades. */
export function normalizeTitle(title: string): string {
  return normalizeText(title).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** La actividad que las reglas reconocen en un título, o null. */
export function detectActivity(title: string): CatalogActivity | null {
  const text = normalizeTitle(title);
  if (!text || ERRAND.test(text)) return null;
  for (const [key, pattern] of RULES) if (pattern.test(text)) return key;
  return null;
}

/**
 * Normaliza una clave que viene de afuera (la IA, un caso): minúsculas, sin acentos, sin
 * espacios. Un sinónimo del catálogo ("gym", "natación") se lleva a su clave. Null si no queda
 * nada usable.
 */
export function normalizeActivityKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = normalizeTitle(raw);
  if (!text) return null;
  const known = (ACTIVITY_KEYS as readonly string[]).includes(text.replace(/ /g, "_")) ? text.replace(/ /g, "_") : detectActivity(text);
  if (known) return known;
  const slug = text.replace(/ /g, "_");
  return /^[a-z][a-z0-9_]{1,29}$/.test(slug) ? slug : null;
}
