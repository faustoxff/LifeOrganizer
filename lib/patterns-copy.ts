import type { AppLanguage } from "@/lib/i18n";
import type { DayPart } from "@/lib/user-patterns";

/**
 * Texto de lo que Spark aprende del usuario ("Cómo trabajás" y la pista al estimar).
 * Español e inglés escritos a mano; el resto de los idiomas muestra el inglés hasta que se
 * traduzca (`patternsCopy`), en vez de mostrar una traducción automática sin revisar.
 */
export type PatternsCopy = {
  /** Debajo del estimado del formulario. */
  hintCategory: (estimateMin: number, category: string, adjustedMin: number) => string;
  hintGeneral: (estimateMin: number, adjustedMin: number) => string;
  section: {
    title: string;
    subtitle: string;
    timeTitle: string;
    /** Faltan N tareas hechas con el modo foco para empezar a aprender. */
    timeLearning: (needed: number) => string;
    timeRow: (category: string, estimatedMin: number, adjustedMin: number, samples: number) => string;
    timeGeneral: string;
    hoursTitle: string;
    hoursLearning: (needed: number) => string;
    hoursBest: (part: string) => string;
    hoursNoBest: string;
    parts: Record<DayPart, string>;
    postponeTitle: string;
    postponedTask: (title: string, times: number) => string;
    postponedCategory: (category: string, times: number) => string;
  };
};

const en: PatternsCopy = {
  hintCategory: (estimate, category, adjusted) => `You estimated ${estimate} min; in ${category} you usually take ~${adjusted}.`,
  hintGeneral: (estimate, adjusted) => `You estimated ${estimate} min; you usually take ~${adjusted}.`,
  section: {
    title: "How you work",
    subtitle: "Learned from your own last 90 days. Nothing leaves your account.",
    timeTitle: "How long things really take",
    timeLearning: (n) => `${n} more ${n === 1 ? "task" : "tasks"} done with focus mode and Spark starts learning how long you take.`,
    timeRow: (category, estimated, adjusted, samples) => `${category}: you estimate ${estimated} min, you take ~${adjusted} (${samples} measured)`,
    timeGeneral: "In general",
    hoursTitle: "When you get the most done",
    hoursLearning: (n) => `${n} more completed ${n === 1 ? "task" : "tasks"} and Spark can tell when you work best.`,
    hoursBest: (part) => `You get the most done in the ${part}.`,
    hoursNoBest: "No clear favourite time of day yet.",
    parts: { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Late night" },
    postponeTitle: "What you keep putting off",
    postponedTask: (title, times) => `${title}: moved ${times} times`,
    postponedCategory: (category, times) => `${category}: ${times} moves across several tasks`
  }
};

const es: PatternsCopy = {
  hintCategory: (estimate, category, adjusted) => `Estimaste ${estimate} min; en ${category} solés tardar ~${adjusted}.`,
  hintGeneral: (estimate, adjusted) => `Estimaste ${estimate} min; solés tardar ~${adjusted}.`,
  section: {
    title: "Cómo trabajás",
    subtitle: "Aprendido de tus últimos 90 días. No sale de tu cuenta.",
    timeTitle: "Cuánto tardás de verdad",
    timeLearning: (n) => `${n === 1 ? "Falta 1 tarea hecha" : `Faltan ${n} tareas hechas`} con el modo foco para que Spark empiece a aprender cuánto tardás.`,
    timeRow: (category, estimated, adjusted, samples) => `${category}: estimás ${estimated} min, tardás ~${adjusted} (${samples} medidas)`,
    timeGeneral: "En general",
    hoursTitle: "Cuándo rendís más",
    hoursLearning: (n) => `${n === 1 ? "Falta 1 tarea completada" : `Faltan ${n} tareas completadas`} para saber a qué hora rendís mejor.`,
    hoursBest: (part) => `Completás más tareas ${part}.`,
    hoursNoBest: "Todavía no hay una franja que se destaque.",
    parts: { morning: "a la mañana", afternoon: "a la tarde", evening: "a la noche", night: "de madrugada" },
    postponeTitle: "Lo que siempre postergás",
    postponedTask: (title, times) => `${title}: la moviste ${times} veces`,
    postponedCategory: (category, times) => `${category}: ${times} postergaciones entre varias tareas`
  }
};

// Los nombres de franja van a mitad de frase en español ("…más tareas a la mañana"); como título
// suelto se capitalizan al mostrarlos.
const catalog: Partial<Record<AppLanguage, PatternsCopy>> & { en: PatternsCopy; es: PatternsCopy } = { en, es };

export function patternsCopy(language: AppLanguage): PatternsCopy {
  return catalog[language] ?? catalog.en;
}
