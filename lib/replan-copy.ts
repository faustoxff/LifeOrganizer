import type { AppLanguage } from "@/lib/i18n";

/**
 * Texto del replan: el aviso de "reacomodé", las acciones de lo atrasado y las marcas de las tareas. Sin culpa: nada
 * suena a reproche y solo un conflicto real con una fecha límite se marca en rojo. Español e inglés escritos a mano;
 * el resto de los idiomas muestra inglés (`replanCopy`).
 */
export type ReplanCopy = {
  moved: (count: number) => string;
  showDetail: string;
  hideDetail: string;
  moveRow: (title: string, from: string, to: string) => string;
  undo: string;
  dismiss: string;
  suggestion: (title: string, times: number) => string;
  split: string;
  lowerPriority: string;
  remove: string;
  left: { title: string; row: (title: string) => string; done: string; tomorrow: string; discard: string };
  dueYesterday: string;
  dueOn: (date: string) => string;
  plannedFor: (date: string) => string;
  pin: string;
  unpin: string;
  pinned: string;
  conflict: { label: string; extend: (days: number) => string; minutes: (min: number) => string };
};

const en: ReplanCopy = {
  moved: (n) => `I rearranged ${n} ${n === 1 ? "task that was" : "tasks that were"} left pending`,
  showDetail: "See details",
  hideDetail: "Hide details",
  moveRow: (title, from, to) => `${title}: ${from} → ${to}`,
  undo: "Undo",
  dismiss: "Got it",
  suggestion: (title, n) => `“${title}” has been moved ${n} times. What should we do with it?`,
  split: "Split into steps",
  lowerPriority: "Lower priority",
  remove: "Delete it",
  left: {
    title: "Left from earlier days",
    row: (title) => `“${title}” is still open`,
    done: "Done",
    tomorrow: "Move to tomorrow",
    discard: "Dismiss"
  },
  dueYesterday: "Was due yesterday",
  dueOn: (date) => `Was due ${date}`,
  plannedFor: (date) => `Planned for ${date}`,
  pin: "Pin (never move it)",
  unpin: "Unpin",
  pinned: "Pinned",
  conflict: {
    label: "Doesn't fit before its deadline",
    extend: (days) => `Move deadline +${days} days`,
    minutes: (min) => `+${min} min per day`
  }
};

const es: ReplanCopy = {
  moved: (n) => `Reacomodé ${n} ${n === 1 ? "tarea que quedó pendiente" : "tareas que quedaron pendientes"}`,
  showDetail: "Ver detalle",
  hideDetail: "Ocultar detalle",
  moveRow: (title, from, to) => `${title}: ${from} → ${to}`,
  undo: "Deshacer",
  dismiss: "Entendido",
  suggestion: (title, n) => `«${title}» ya se movió ${n} veces. ¿Qué hacemos con ella?`,
  split: "Dividir en pasos",
  lowerPriority: "Bajar prioridad",
  remove: "Borrarla",
  left: {
    title: "Quedaron de días anteriores",
    row: (title) => `«${title}» sigue abierta`,
    done: "Hecho",
    tomorrow: "Pasar a mañana",
    discard: "Descartar"
  },
  dueYesterday: "Venció ayer",
  dueOn: (date) => `Venció el ${date}`,
  plannedFor: (date) => `Planificada para ${date}`,
  pin: "Fijar (que no se mueva nunca)",
  unpin: "Soltar",
  pinned: "Fijada",
  conflict: {
    label: "No entra antes de su fecha límite",
    extend: (days) => `Correr la fecha +${days} días`,
    minutes: (min) => `+${min} min por día`
  }
};

const catalog: Partial<Record<AppLanguage, ReplanCopy>> & { en: ReplanCopy; es: ReplanCopy } = { en, es };

export function replanCopy(language: AppLanguage): ReplanCopy {
  return catalog[language] ?? catalog.en;
}
