import type { TaskKind } from "@/types/task";

/**
 * Sugerencia del tipo de tarea al crearla. Reglas, sin IA: el formulario
 * preselecciona el resultado en unos chips que el usuario puede cambiar, así que
 * un error acá cuesta un clic y no justifica una llamada a un modelo.
 */

export type KindInput = {
  title: string;
  description?: string;
  /** "YYYY-MM-DD". Sin fecha no se puede sugerir proyecto. */
  dueDate?: string;
  /** "HH:MM". Sin hora no se puede sugerir recordatorio. */
  time?: string;
  /** Inyectable para tests. Por defecto, el día de hoy en la zona del dispositivo. */
  today?: string;
};

/** Un recordatorio es una acción de segundos: el título cabe en una línea corta. */
const REMINDER_MAX_CHARS = 50;
const REMINDER_MAX_WORDS = 7;

/** Más lejos que esto, con pinta de entrega, ya es algo a repartir en días. */
const PROJECT_MIN_DAYS_AHEAD = 3;
const PROJECT_LONG_DESCRIPTION_CHARS = 280;

// Verbos de acción puntual (es/en). Se comparan sin acentos y como palabra
// completa: "comprar" no debe encenderse por "compraron" ni "pagar" por "apagar".
const REMINDER_VERBS = [
  "pagar", "pago", "llamar", "comprar", "sacar turno", "pedir turno", "reservar",
  "mandar", "enviar", "renovar", "retirar", "devolver", "avisar", "confirmar",
  "escribirle", "cancelar", "recordar",
  "pay", "call", "buy", "book", "send", "renew", "pick up", "return", "text", "email",
  "cancel", "confirm", "remind"
];

const PROJECT_WORDS = [
  "entrega", "entregar", "entregable", "tp", "trabajo practico", "parcial", "proyecto",
  "informe", "tesis", "monografia", "examen", "final de",
  "assignment", "project", "report", "exam", "thesis", "deliverable", "deadline"
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => new RegExp(`(^| )${term}( |$)`).test(text));
}

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function daysAhead(dueDate: string, today: string): number {
  const ms = Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.round(ms / 86_400_000);
}

export function suggestKind(input: KindInput): TaskKind {
  const title = normalize(input.title);
  const description = normalize(input.description ?? "");
  const rawDescription = (input.description ?? "").trim();

  const isFarAway =
    Boolean(input.dueDate) &&
    daysAhead(input.dueDate as string, input.today ?? localToday()) > PROJECT_MIN_DAYS_AHEAD;

  // Recordatorio: título corto + hora + verbo de acción puntual. Las tres a la vez:
  // "Comprar pan" sin hora es una tarea del día, no un aviso a una hora.
  const words = title.split(" ").filter(Boolean);
  const isShort = title.length <= REMINDER_MAX_CHARS && words.length <= REMINDER_MAX_WORDS;
  if (input.time && isShort && containsAny(title, REMINDER_VERBS)) {
    return "reminder";
  }

  // Proyecto: lejos en el tiempo Y (pinta de entrega O descripción larga). Cada
  // condición sola se equivoca: "TP de álgebra" para mañana es una tarea, y un
  // texto largo para hoy también.
  if (isFarAway) {
    const looksLikeDeliverable =
      containsAny(title, PROJECT_WORDS) || containsAny(description, PROJECT_WORDS);
    if (looksLikeDeliverable || rawDescription.length >= PROJECT_LONG_DESCRIPTION_CHARS) {
      return "project";
    }
  }

  return "task";
}
