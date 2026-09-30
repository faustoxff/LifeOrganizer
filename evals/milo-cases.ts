import type { Task } from "@/types/task";

/**
 * Evals for Milo's chat behaviour, run against the real Groq models.
 *
 * The parser unit tests prove we can read a well-formed block. These cases ask
 * the harder question: does Milo actually understand a person typing on a phone
 * between classes, and does the reply stay comfortable?
 *
 * Two failure modes matter equally here and they pull in opposite directions:
 *
 *  - Silent no-op. User says "gimnasio los miércoles y sábados", gets a friendly
 *    sentence, and no tasks. Looks like the app is broken.
 *  - Over-eager. User asks what a simplex is and gets three tasks invented for
 *    them. Feels like a nag bot, and they leave.
 *
 * So `expectTasks: "none"` is as load-bearing as `expectTasks: "some"`.
 */

export const NOW = new Date("2026-09-28T12:00:00.000Z"); // a Monday, 2026

export const iso = (d: Date) => d.toISOString().split("T")[0];

export function addDays(from: Date, n: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return d;
}

/** ISO date of the next occurrence of `weekday` (0=Sun..6=Sat), 0 if today. */
export function nextWeekday(from: Date, weekday: number, weeksAhead = 0): string {
  const d = new Date(from);
  const delta = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta + weeksAhead * 7);
  return iso(d);
}

export const TODAY = iso(NOW);
export const TOMORROW = iso(addDays(NOW, 1));
export const IN_3_DAYS = iso(addDays(NOW, 3));
export const NEXT_WEEK = iso(addDays(NOW, 7));

// Monday=1 .. Friday=5
export const WED = nextWeekday(NOW, 3);
export const WED_PLUS_1W = nextWeekday(NOW, 3, 1);
export const WED_PLUS_2W = nextWeekday(NOW, 3, 2);
export const WED_PLUS_3W = nextWeekday(NOW, 3, 3);
export const SAT = nextWeekday(NOW, 6);
export const SAT_PLUS_1W = nextWeekday(NOW, 6, 1);
export const SAT_PLUS_2W = nextWeekday(NOW, 6, 2);
export const SAT_PLUS_3W = nextWeekday(NOW, 6, 3);
export const FRI = nextWeekday(NOW, 5);
export const THU = nextWeekday(NOW, 4);

const sampleTasks = (): Task[] => [
  {
    id: "t1",
    title: "Entregar TP de álgebra",
    category: "universidad",
    description: "",
    priority: "high",
    estimateMin: 120,
    kind: "task",
    status: "pending",
    dueDate: IN_3_DAYS,
    done: false
  }
];

export type Expectation = {
  /**
   * "some" = at least one task must be proposed. "none" = must propose none.
   * "either" = both are acceptable, so only the comfort checks apply. Used where
   * the product genuinely has two good answers, e.g. "armame un plan de estudio
   * para un parcial": proposing a generic study task and asking which topics are
   * on the exam are both fine, and pinning either one just encodes a preference
   * as a bug.
   */
  tasks: "some" | "none" | "either";
  /** When set, the proposed set must cover these titles (substring match). */
  titles?: string[];
  /** When set, the proposed set must contain these exact dates. */
  dates?: string[];
  /**
   * The proposed set must include at least one date on each listed weekday
   * (0=Sun..6=Sat). This is the invariant that actually matters for a recurring
   * request: "gym on Wednesdays and Saturdays" is right whether the run starts
   * this week or next, but wrong if every task lands on a Tuesday.
   */
  weekdays?: number[];
  /**
   * At least one task must land on or before these dates. Used where several
   * answers are genuinely fine, e.g. studying for an exam: the day before and
   * the day of are both correct, the day after is not.
   */
  datesOnOrBefore?: string[];
  /**
   * At least one proposed item must carry a `repeat` of this frequency (and cover
   * these weekdays, 0=Sun..6=Sat). A recurrence is ONE item with `repeat`; the
   * server generates the occurrences.
   */
  repeat?: { freq: "daily" | "weekly" | "monthly"; weekdays?: number[]; monthDay?: number };
  /**
   * Ceiling on how many items may be proposed. It is what catches the model
   * going back to one task per occurrence ("una tarea por vez").
   */
  maxTasks?: number;
  /** Hard ceiling on visible reply length. Comfort is part of correctness. */
  maxChars?: number;
  /** Only for plan-free cases: the reply must point at the upgrade path. */
  mentionsUpgrade?: boolean;
};

export type EvalCase = {
  name: string;
  message: string;
  expectation: Expectation;
  plan?: "free" | "plus" | "pro";
  tasks?: Task[];
  history?: Array<{ role: "user" | "milo"; content: string }>;
  userMemory?: string;
  /** Seeded in the prompt so relative dates are deterministic. */
  now?: Date;
  /** Cases here are inherently fuzzy; excluded from the strict pass rate. */
  soft?: boolean;
  note?: string;
};

export const CASES: EvalCase[] = [
  // ---------------------------------------------------------------- recurrence
  {
    name: "recurrencia: gym dos dias por semana",
    // The reported bug: this expands to many occurrences and used to overflow
    // the token budget, losing the entire batch with nothing in the logs.
    message:
      "mañana voy a cursar a la mañana y voy al gimnasio miércoles y sábados",
    // Wednesdays and Saturdays are the requirement, and they travel in ONE item
    // with `repeat`, not as a task per occurrence. "cursar" is a second item.
    expectation: {
      tasks: "some",
      titles: ["gimnasio", "cursar"],
      dates: [TOMORROW],
      repeat: { freq: "weekly", weekdays: [3, 6] },
      maxTasks: 3
    }
  },
  {
    name: "recurrencia: todos los lunes pago el alquiler",
    message: "todos los lunes tengo que pagar el alquiler, agendamelo",
    // Said on a Monday: starting today or next Monday are both defensible, so
    // pin the shape (a weekly repeat on Mondays that starts within the next 2
    // weeks) rather than one exact day.
    expectation: {
      tasks: "some",
      titles: ["alquiler"],
      datesOnOrBefore: [iso(addDays(NOW, 8))],
      repeat: { freq: "weekly", weekdays: [1] },
      maxTasks: 1
    }
  },
  {
    name: "recurrencia: frase corta y coloquial",
    message: "gimnasio los martes",
    expectation: {
      tasks: "some",
      titles: ["gimnasio"],
      repeat: { freq: "weekly", weekdays: [2] },
      maxTasks: 1
    }
  },
  {
    name: "recurrencia: cada dia sin decir el dia",
    message: "tengo que llamar a mi mamá todos los días",
    expectation: { tasks: "some", titles: ["mamá"], repeat: { freq: "daily" }, maxTasks: 1 }
  },

  {
    name: "recurrencia: mensual con dia del mes",
    message: "el 5 de cada mes tengo que pagar el alquiler",
    expectation: { tasks: "some", titles: ["alquiler"], repeat: { freq: "monthly", monthDay: 5 }, maxTasks: 1 }
  },
  {
    name: "recurrencia: no expande una tarea por ocurrencia",
    // The behaviour this stage exists to remove: "todos los días durante un mes"
    // used to become 12 objects and overflow the block.
    message: "quiero tomar agua todos los días durante un mes, agendamelo",
    expectation: { tasks: "some", titles: ["agua"], repeat: { freq: "daily" }, maxTasks: 1 }
  },

  // -------------------------------------------------------------- explicit ask
  {
    name: "explicito: agenda con manana",
    message: "agendame comprar pan mañana",
    expectation: { tasks: "some", titles: ["pan"], dates: [TOMORROW] }
  },
  {
    name: "explicito: recordame sin fecha",
    // No date given. Must still propose one rather than staying silent.
    message: "recordame mandar el CV a la empresa",
    expectation: { tasks: "some", titles: ["CV", "empresa"] }
  },
  {
    name: "explicito: nueva tarea con prioridad",
    message: "creame una tarea urgente: llamar al banco antes de que cierre",
    expectation: { tasks: "some" }
  },

  // ------------------------------------------------------------- implicit needs
  {
    name: "implicito: menciona algo a hacer con fecha",
    message: "el viernes entrego el trabajo de historia y estoy todavía a medio hacer",
    // Scheduling the work before the deadline is the better answer, so pin
    // "on or before Friday" rather than demanding a task on Friday itself.
    expectation: { tasks: "some", titles: ["trabajo", "historia"], datesOnOrBefore: [FRI] }
  },
  {
    name: "implicito: examen con dia explicito",
    message: "tengo parcial de cálculo el jueves y no estudié nada",
    // Studying the day before or on the day both work. What must never happen is
    // the model inventing that the exam is "mañana" — that produced a task on
    // the wrong date while confidently stating a false fact.
    expectation: { tasks: "some", titles: ["cálculo"], datesOnOrBefore: [THU] }
  },
  {
    name: "implicito: sin fecha, solo intencion",
    message: "tengo que ir al médico pero no me animo a sacar turno",
    expectation: { tasks: "some", titles: ["médico"] }
  },
  {
    name: "implicito: varias tareas en un mensaje",
    message:
      "mañana tengo que entregar un trabajo, el miércoles rindo y después quiero ir al gimnasio",
    expectation: { tasks: "some", titles: ["trabajo"], dates: [TOMORROW, WED] }
  },
  {
    name: "implicito: negativo claro, no debe crear nada",
    message: "no tengo que hacer nada mañana, es domingo",
    expectation: { tasks: "none" }
  },

  // ------------------------------------------------------- must NOT create tasks
  {
    name: "no-crea: pregunta de concepto",
    message: "¿qué es un simplex?",
    expectation: { tasks: "none" }
  },
  {
    name: "no-crea: charla",
    message: "hola, cómo andás?",
    expectation: { tasks: "none" }
  },
  {
    name: "no-crea: opinion",
    message: "¿te parece buena idea estudiar de noche?",
    expectation: { tasks: "none" }
  },
  {
    name: "no-crea: praise sin accion",
    message: "buenísimo lo que me dijiste ayer, me sirvió un montón",
    expectation: { tasks: "none" }
  },
  {
    name: "no-crea: ya lo hice",
    message: "ya entregué el trabajo, era para hoy",
    expectation: { tasks: "none" }
  },
  {
    name: "no-crea: chiste",
    message: "jajaja me estás matando 😂",
    expectation: { tasks: "none" }
  },
  {
    name: "no-crea: pregunta sobre el estado de sus tareas",
    message: "y mis tareas?",
    expectation: { tasks: "none" },
    tasks: sampleTasks()
  },
  {
    name: "no-crea: desahogo sin tarea",
    message: "estoy re estresado con la universidad, no me rinde el tiempo",
    expectation: { tasks: "none" }
  },

  // ---------------------------------------------------------------- paywall/free
  {
    name: "free: pide crear y debe orientar al upgrade",
    message: "agendame ir al gym mañana",
    plan: "free",
    expectation: { tasks: "none", mentionsUpgrade: true }
  },
  {
    name: "free: menciona algo a hacer y igual no crea",
    message: "el jueves tengo parcial de física",
    plan: "free",
    expectation: { tasks: "none" }
  },

  // ------------------------------------------------------------------ robustness
  {
    name: "robustez: todo en mayusculas y sin acentos",
    message: "AGENDAEME LLAMAR AL BANCO MANANA",
    expectation: { tasks: "some", dates: [TOMORROW] }
  },
  {
    name: "robustez: sin espacios ni puntuacion",
    message: "recordamecomprarpanmanana",
    expectation: { tasks: "some", dates: [TOMORROW] }
  },
  {
    name: "robustez: mensaje largo con muchas tareas",
    message:
      "necesito: comprar los apuntes de la facultad, llamar al centro medico para pedir un turno, renovar el carnet de la biblioteca, mandar el cv a la empresa, pagar el servicio de luz, llamar a mi tia, comprar comida para el perro, y revisar los apuntes de calculo",
    expectation: { tasks: "some" }
  },
  {
    name: "robustez: typo comun",
    message: "agendame calledar al banco manana",
    expectation: { tasks: "some" }
  },
  {
    name: "robustez: emoji y didnt",
    message: "mañana tengo q entregar la T.P. 😩 please recordamelo",
    expectation: { tasks: "some", dates: [TOMORROW] }
  },

  // --------------------------------------------------------------- comfort/length
  {
    name: "comfort: respuesta corta a una pregunta simple",
    message: "¿qué es un simplex?",
    expectation: { tasks: "none", maxChars: 600 }
  },
  {
    name: "comfort: no volcar un plan gigante",
    // Proposing one study task here is right, not over-eager: the user said they
    // have an exam. The only real constraint is that it stays short.
    message: "armame un plan de estudio para un mes para un parcial de física",
    expectation: { tasks: "either", maxChars: 900 }
  },
  {
    name: "comfort: plan detallado si lo pide",
    message: "explicame en detalle cómo se hace una integral por partes",
    expectation: { tasks: "none", maxChars: 3000 }
  },

  // ------------------------------------------------------------ regressions found
  // The pro model told users "he creado la tarea" and then showed them a
  // confirm button. It also invented a task when someone only asked how they
  // were doing. Both read as a lie, so both are pinned here.
  {
    name: "regresion: no inventar tareas al preguntar el estado",
    message: "¿cómo voy con mis tareas?",
    expectation: { tasks: "none" },
    tasks: sampleTasks()
  },
  {
    name: "regresion: no afirmar que ya creo la tarea",
    message: "agendame llamar al banco mañana",
    expectation: { tasks: "some", titles: ["banco"], dates: [TOMORROW] }
  },
  {
    name: "regresion: propone y no pregunta primero",
    // Regression for the original report: the model used to reply "¿querés que te
    // arme un plan?" and create nothing, and the user read that as broken.
    message: "tengo parcial de cálculo el jueves y no estudié nada",
    expectation: { tasks: "some", titles: ["cálculo"], datesOnOrBefore: [THU] }
  },
  {
    name: "regresion: pide un dia y no propone con el default",
    message: "recordame mandar el CV a la empresa",
    expectation: { tasks: "some", titles: ["CV", "empresa"] }
  },
  {
    name: "regresion: recurrente diaria sin pedir permiso",
    message: "tengo que llamar a mi mamá todos los días",
    expectation: { tasks: "some", titles: ["mamá"], repeat: { freq: "daily" }, maxTasks: 1 }
  },
  {
    name: "regresion: voseo consistente",
    message: "¿qué es un simplex?",
    expectation: { tasks: "none", maxChars: 600 }
  }
];
