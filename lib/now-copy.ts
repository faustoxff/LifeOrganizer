import type { AppLanguage } from "@/lib/i18n";
import { formatMinutes } from "@/lib/task-estimate";
import type { FreeWindow } from "@/lib/busy-blocks";
import { formatLocalTime } from "@/lib/busy-blocks";
import type { Recommendation } from "@/lib/recommendation";

/**
 * Texto de "qué hago ahora": la línea de tiempo libre, la razón de la recomendación y los
 * controles. Español e inglés escritos a mano; el resto de los idiomas muestra el inglés
 * (`nowCopy`), como el texto de patrones. La razón sale de datos estructurados (`code`, minutos,
 * bloque), no de la IA: siempre es una sola línea.
 */
export type NowCopy = {
  title: string;
  freeUntil: (free: string, title: string, time: string) => string;
  free: (free: string) => string;
  inBlock: (title: string, until: string) => string;
  noTime: (title: string, time: string) => string;
  chips: { m15: string; m30: string; h1: string; more: string; tired: string; other: string; auto: string; manual: string };
  rest: { title: string; text: string };
  prepare: { title: string; text: (title: string, time: string) => string; checklist: string; checklistEmpty: string };
  advance: (minutes: string) => string;
  finish: (minutes: string) => string;
  /** Una línea con el motivo. `mode` distingue terminar de avanzar. */
  reason: (input: ReasonInput) => string;
  prep: { title: string; calendar: string; reminder: string; hint: string; minutes: (n: number) => string };
};

export type ReasonInput = {
  code: string;
  mode?: "finish" | "advance";
  free: string;
  need?: string;
  work?: string;
  blockTitle?: string;
  blockTime?: string;
  type?: "rest" | "prepare";
};

const en: NowCopy = {
  title: "Right now",
  freeUntil: (free, title, time) => `You have ~${free} free (until ${title} ${time})`,
  free: (free) => `You have ~${free} free`,
  inBlock: (title, until) => `You're in ${title} (until ${until})`,
  noTime: (title, time) => `${title} starts at ${time}: time to get ready`,
  chips: { m15: "15 min", m30: "30 min", h1: "1 h", more: "More", tired: "I'm tired", other: "Another", auto: "Use my calendar", manual: "Adjusted by hand" },
  rest: { title: "Take a break", text: "Nothing pressing fits right now." },
  prepare: {
    title: "Get ready",
    text: (title, time) => `${title} is at ${time}.`,
    checklist: "Don't forget",
    checklistEmpty: "No list for this one yet."
  },
  advance: (minutes) => `Work ${minutes} on it`,
  finish: (minutes) => `Takes ~${minutes}`,
  reason: (r) => {
    const until = r.blockTitle && r.blockTime ? `until ${r.blockTitle} (${r.blockTime})` : "";
    switch (r.code) {
      case "IN_BLOCK":
        return `You're in ${r.blockTitle ?? "something"} right now.`;
      case "PREP_WINDOW":
        return `${r.blockTitle ?? "Your next commitment"} starts at ${r.blockTime ?? "soon"}: time to ${r.type === "prepare" ? "get ready" : "wrap up"}.`;
      case "NO_TASKS":
        return r.type === "prepare" && r.blockTitle ? `Nothing pending. Get ready for ${r.blockTitle} (${r.blockTime}).` : "Nothing pending. Enjoy the free time.";
      case "NOTHING_FITS":
      case "ONLY_LOW":
        return until
          ? `You have ${r.free} ${until}. Nothing urgent fits: ${r.type === "prepare" ? "rest or get ready" : "take a break"}.`
          : `You have ${r.free} free. Nothing urgent fits: take a break.`;
      case "OVERDUE":
        return r.mode === "advance" ? `It's overdue: use ${r.work} of your ${r.free} to move it forward.` : `It's overdue and fits your ${r.free}.`;
      case "DUE_TODAY":
        return r.mode === "advance" ? `Due today: use ${r.work} of your ${r.free} to move it forward.` : `Due today and it fits your ${r.free}.`;
      case "HIGH_PRIORITY":
        return r.mode === "advance" ? `High priority: move it forward ${r.work}.` : `High priority and it fits your ${r.free}.`;
      case "TIRED_LIGHT":
        return `Short and light, good for now. Fits your ${r.free}.`;
      default:
        return r.mode === "advance" ? `Too long for ${r.free}: move it forward ${r.work}.` : `Fits your ${r.free}.`;
    }
  },
  prep: {
    title: "Margin before commitments",
    calendar: "Calendar events",
    reminder: "Reminders and timed tasks",
    hint: "Time Spark leaves free before a commitment, to get ready or travel.",
    minutes: (n) => (n === 0 ? "None" : `${n} min`)
  }
};

const es: NowCopy = {
  title: "Ahora",
  freeUntil: (free, title, time) => `Tenés ~${free} libres (hasta ${title} ${time})`,
  free: (free) => `Tenés ~${free} libres`,
  inBlock: (title, until) => `Estás en ${title} (hasta ${until})`,
  noTime: (title, time) => `${title} empieza a las ${time}: hora de prepararte`,
  chips: { m15: "15 min", m30: "30 min", h1: "1 h", more: "Más", tired: "Estoy cansado", other: "Otra", auto: "Usar mi agenda", manual: "Ajustado a mano" },
  rest: { title: "Descansá", text: "Nada urgente entra ahora." },
  prepare: {
    title: "Prepárate",
    text: (title, time) => `${title} es a las ${time}.`,
    checklist: "No te olvides",
    checklistEmpty: "Todavía no hay lista para esto."
  },
  advance: (minutes) => `Avanzá ${minutes}`,
  finish: (minutes) => `Lleva ~${minutes}`,
  reason: (r) => {
    const until = r.blockTitle && r.blockTime ? `hasta ${r.blockTitle} (${r.blockTime})` : "";
    switch (r.code) {
      case "IN_BLOCK":
        return `Ahora estás en ${r.blockTitle ?? "un compromiso"}.`;
      case "PREP_WINDOW":
        return `${r.blockTitle ?? "Tu próximo compromiso"} empieza a las ${r.blockTime ?? "en un rato"}: ${r.type === "prepare" ? "hora de prepararte" : "andá cerrando"}.`;
      case "NO_TASKS":
        return r.type === "prepare" && r.blockTitle ? `No tenés nada pendiente. Prepárate para ${r.blockTitle} (${r.blockTime}).` : "No tenés nada pendiente. Disfrutá el rato libre.";
      case "NOTHING_FITS":
      case "ONLY_LOW":
        return until
          ? `Tenés ${r.free} ${until}. Nada urgente entra: ${r.type === "prepare" ? "descansá o preparate" : "descansá"}.`
          : `Tenés ${r.free} libres. Nada urgente entra: descansá.`;
      case "OVERDUE":
        return r.mode === "advance" ? `Está vencida: usá ${r.work} de tus ${r.free} para avanzarla.` : `Está vencida y entra en tus ${r.free}.`;
      case "DUE_TODAY":
        return r.mode === "advance" ? `Vence hoy: usá ${r.work} de tus ${r.free} para avanzarla.` : `Vence hoy y entra en tus ${r.free}.`;
      case "HIGH_PRIORITY":
        return r.mode === "advance" ? `Es de prioridad alta: avanzala ${r.work}.` : `Es de prioridad alta y entra en tus ${r.free}.`;
      case "TIRED_LIGHT":
        return `Corta y liviana, ideal para ahora. Entra en tus ${r.free}.`;
      default:
        return r.mode === "advance" ? `Es larga para ${r.free}: avanzala ${r.work}.` : `Entra en tus ${r.free}.`;
    }
  },
  prep: {
    title: "Margen antes de un compromiso",
    calendar: "Eventos de calendario",
    reminder: "Recordatorios y tareas con hora",
    hint: "El tiempo que Spark deja libre antes de un compromiso, para prepararte o viajar.",
    minutes: (n) => (n === 0 ? "Ninguno" : `${n} min`)
  }
};

const catalog: Partial<Record<AppLanguage, NowCopy>> & { en: NowCopy; es: NowCopy } = { en, es };

export function nowCopy(language: AppLanguage): NowCopy {
  return catalog[language] ?? catalog.en;
}

// ---------------------------------------------------------------------------
// Armar las líneas a partir de los datos
// ---------------------------------------------------------------------------

/** La línea de arriba de la tarjeta: cuánto tiempo hay y hasta qué. */
export function windowLine(copy: NowCopy, window: FreeWindow, timeZone: string): string {
  const { currentBlock, nextBlock } = window;
  if (currentBlock) return copy.inBlock(currentBlock.title, formatLocalTime(currentBlock.end, timeZone));
  if (window.freeMin <= 0 && nextBlock) return copy.noTime(nextBlock.title, formatLocalTime(nextBlock.start, timeZone));
  const free = formatMinutes(window.freeMin);
  return nextBlock && window.limit !== "capacity"
    ? copy.freeUntil(free, nextBlock.title, formatLocalTime(nextBlock.start, timeZone))
    : copy.free(free);
}

/** La razón de una recomendación, en una línea. */
export function reasonLine(copy: NowCopy, rec: Recommendation, timeZone: string): string {
  if (rec.type === "task") {
    return copy.reason({
      code: rec.reason.code,
      mode: rec.mode,
      free: formatMinutes(rec.reason.freeMin),
      need: formatMinutes(rec.needMin),
      work: formatMinutes(rec.minutes)
    });
  }
  const { block } = rec.reason;
  return copy.reason({
    code: rec.reason.code,
    type: rec.type,
    free: formatMinutes(rec.reason.freeMin),
    ...(block ? { blockTitle: block.title, blockTime: formatLocalTime(rec.reason.code === "IN_BLOCK" ? block.end : block.start, timeZone) } : {})
  });
}
