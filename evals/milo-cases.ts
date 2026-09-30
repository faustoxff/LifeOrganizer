import type { Task, TaskInput } from "@/types/task";

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
export const TUE = nextWeekday(NOW, 2);
export const SUN = nextWeekday(NOW, 0);
/** El lunes de la semana que viene: el weekStart de "la semana que viene". */
export const NEXT_MON = iso(addDays(NOW, 7));

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

  // ---- Solo camino de tools. En el modo legacy estos chequeos se saltean. ----
  /** Esta tool tiene que haberse usado (y se ejecutó sin error). */
  tool?: "create_items" | "plan_week" | "get_schedule" | "ask_user";
  /** Milo tiene que preguntar con ask_user y no proponer nada: falta un dato necesario. */
  askUser?: boolean;
  /** La propuesta semanal tiene que repartirse en al menos esta cantidad de días distintos. */
  distinctDays?: number;
  /** La propuesta semanal tiene que arrancar este día (weekStart). */
  weekStart?: string;

  // ---- Valen en los dos modos. ----
  /** Al menos esta cantidad de ítems propuestos. Es lo que atrapa "se olvidó de uno". */
  minTasks?: number;
  /** Ese ítem (substring del título) tiene que estar exactamente en esa fecha. */
  titleOn?: Record<string, string>;
  /** Ese ítem (substring del título) tiene que estar en esa fecha o antes. */
  titleOnOrBefore?: Record<string, string>;
  /** La respuesta visible tiene que nombrar todo esto (substring, sin importar mayúsculas). */
  mentions?: string[];

  // ---- Memoria (solo tools). ----
  /** Milo tiene que haber guardado un hecho que el usuario dijo: la clave o el valor casan con esto. */
  savesFact?: RegExp;
  /** Milo no puede haber guardado NI propuesto ningún hecho. */
  savesNoFact?: boolean;
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
  /** Ítems de una propuesta pendiente de confirmar, como los manda el cliente. */
  pending?: TaskInput[];
  /** El caso solo tiene sentido con tools (por ejemplo, ask_user). En modo legacy se saltea. */
  toolsOnly?: boolean;
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

  // ------------------------------------------------------------------ organizar la semana
  // `plan_week`: el modelo junta lo que el usuario nombró y el servidor lo reparte. Lo que se
  // mide acá es lo que decide el modelo: que use la tool, que no se olvide de ninguna cosa,
  // que ponga fija solo la que tiene día, y que la respuesta no repita la tarjeta.
  {
    name: "semana: organizame la semana con seis cosas",
    message:
      "organizame la semana: tengo que entregar el informe de física el jueves, estudiar para el parcial de cálculo del viernes, ir al gimnasio, llamar al banco, comprar los regalos y limpiar el departamento",
    expectation: {
      tasks: "some",
      tool: "plan_week",
      minTasks: 6,
      titles: ["informe", "banco", "regalos"],
      titleOnOrBefore: { informe: THU },
      distinctDays: 3,
      maxChars: 700
    },
    toolsOnly: true
  },
  {
    name: "semana: ocho cosas con una recurrente y un turno con hora",
    message:
      "armame la semana: gimnasio lunes, miércoles y viernes, el informe para el jueves, llamar al médico, comprar comida, estudiar inglés, pagar la luz, dentista el martes a las 10 y limpiar la casa",
    expectation: {
      tasks: "some",
      tool: "plan_week",
      minTasks: 8,
      // La recurrencia es UN ítem, no tres: el total no puede pasar de lo que se nombró.
      maxTasks: 8,
      repeat: { freq: "weekly", weekdays: [1, 3, 5] },
      titles: ["gimnasio", "informe", "dentista"],
      titleOn: { dentista: TUE },
      titleOnOrBefore: { informe: THU },
      maxChars: 700
    },
    toolsOnly: true
  },
  {
    name: "semana: la semana que viene y todo recurrente",
    message:
      "organizame la semana que viene: gimnasio martes y jueves, inglés lunes y miércoles a la noche y repasar apuntes todos los días",
    expectation: {
      tasks: "some",
      tool: "plan_week",
      weekStart: NEXT_MON,
      minTasks: 3,
      maxTasks: 3,
      repeat: { freq: "weekly", weekdays: [2, 4] },
      maxChars: 700
    },
    toolsOnly: true
  },
  {
    name: "semana: cinco cosas del día a día, sin fechas",
    message: "ayudame a repartir esta semana: hacer la compra, ir al correo, arreglar la bici, llamar al plomero y devolver el libro a la biblioteca",
    expectation: { tasks: "some", tool: "plan_week", minTasks: 5, distinctDays: 3, maxChars: 700 },
    toolsOnly: true
  },

  // ------------------------------------------------------------------ varias cosas en un mensaje
  {
    name: "varias: cinco cosas con día distinto, todas en una llamada",
    message:
      "mañana tengo que entregar el TP, el miércoles rindo álgebra, el jueves llamar al médico, el viernes pagar el alquiler y el sábado ir a lo de mi tía",
    expectation: {
      tasks: "some",
      tool: "create_items",
      minTasks: 5,
      maxTasks: 5,
      dates: [TOMORROW, WED, THU, FRI, SAT],
      titles: ["TP", "álgebra", "médico", "alquiler", "tía"]
    }
  },
  {
    name: "varias: recurrente, recordatorio con hora y tarea suelta",
    message: "gimnasio martes y jueves, mañana a las 9 pagar la luz y el viernes entrego el informe",
    expectation: {
      tasks: "some",
      tool: "create_items",
      minTasks: 3,
      maxTasks: 3,
      repeat: { freq: "weekly", weekdays: [2, 4] },
      titleOn: { informe: FRI, luz: TOMORROW },
      titles: ["gimnasio", "luz", "informe"]
    }
  },
  {
    name: "varias: ocho pendientes sueltos no se pierden ninguno",
    message:
      "anotame: comprar los apuntes, llamar al centro médico, renovar el carnet de la biblioteca, mandar el cv, pagar la luz, llamar a mi tía, comprar comida del perro y revisar los apuntes de cálculo",
    expectation: { tasks: "some", tool: "create_items", minTasks: 8, maxTasks: 8 }
  },

  // ------------------------------------------------------------------ falta un dato: ask_user
  {
    name: "ask_user: organizame la semana sin decir qué",
    message: "organizame la semana",
    expectation: { tasks: "none", askUser: true, maxChars: 400 },
    toolsOnly: true
  },
  {
    name: "ask_user: armame el plan pero no dice qué cosas",
    message: "tengo un montón de cosas por hacer, armame un plan para estos días",
    expectation: { tasks: "none", askUser: true, maxChars: 400 },
    toolsOnly: true
  },
  {
    name: "ask_user: no pregunta por una fecha suelta cuando el resto está claro",
    // Contraparte del caso de arriba: acá SÍ hay qué agendar, así que preguntar "¿para qué día?"
    // sería el error inverso (el prompt dice: proponé con un default).
    message: "agendame llamar al banco",
    expectation: { tasks: "some", tool: "create_items", titles: ["banco"], maxTasks: 1 }
  },

  // ------------------------------------------------------------------ consultar la agenda
  {
    name: "agenda: qué tengo el jueves",
    message: "¿qué tengo el jueves?",
    tasks: sampleTasks(),
    // La tarea de álgebra vence el jueves. Puede contestarla de la lista o consultando get_schedule:
    // las dos están bien. Lo que no puede es inventar cosas ni proponer nada.
    expectation: { tasks: "none", mentions: ["álgebra"], maxChars: 500 }
  },
  {
    name: "agenda: sin nada agendado lo dice",
    message: "¿tengo algo el martes?",
    expectation: { tasks: "none", maxChars: 400 }
  },

  // ------------------------------------------------------------------ cambios sobre una propuesta
  {
    name: "cambio: mover un ítem de la propuesta pendiente",
    message: "pasá el informe al miércoles",
    pending: [
      { title: "Informe", category: "general", description: "", priority: "medium", estimateMin: 90, dueDate: TUE, kind: "task" },
      { title: "Comprar regalos", category: "general", description: "", priority: "medium", estimateMin: 45, dueDate: THU, kind: "task" },
      { title: "Llamar al banco", category: "general", description: "", priority: "medium", estimateMin: 10, dueDate: FRI, kind: "reminder" }
    ],
    history: [
      { role: "user", content: "organizame la semana: informe, regalos y llamar al banco" },
      { role: "milo", content: "Te propongo el informe el martes, los regalos el jueves y el banco el viernes." }
    ],
    // Vuelve a llamar la tool con la lista COMPLETA: el informe el miércoles y los otros dos siguen ahí.
    expectation: { tasks: "some", minTasks: 3, maxTasks: 3, titleOn: { informe: WED }, titles: ["regalos", "banco"] }
  },
  {
    name: "cambio: sacar un ítem de la propuesta pendiente",
    message: "el gimnasio sacalo, no voy a ir",
    pending: [
      { title: "Gimnasio", category: "general", description: "", priority: "medium", estimateMin: 60, dueDate: TUE, kind: "task" },
      { title: "Informe", category: "general", description: "", priority: "medium", estimateMin: 90, dueDate: WED, kind: "task" }
    ],
    history: [
      { role: "user", content: "organizame la semana: gimnasio e informe" },
      { role: "milo", content: "Gimnasio el martes e informe el miércoles." }
    ],
    expectation: { tasks: "some", minTasks: 1, maxTasks: 1, titles: ["informe"], titleOn: { informe: WED } }
  },

  // ------------------------------------------------------------------ memoria: hechos del usuario
  // `remember_fact` guarda solo lo que el usuario dijo de sí mismo, y nunca datos sensibles. Los dos
  // errores pesan igual: no guardar "soy despistado" es una oportunidad perdida; guardar "tengo
  // diabetes" es un dato que Spark no debería tener.
  {
    name: "memoria: dice que es despistado y va al gimnasio",
    message: "soy re despistado, siempre me olvido todo. mañana voy al gimnasio a las 7",
    expectation: { tasks: "some", tool: "create_items", titles: ["gimnasio"], dates: [TOMORROW], savesFact: /despistad|olvid/i, maxChars: 500 },
    toolsOnly: true
  },
  {
    name: "memoria: cuenta en qué horario rinde",
    message: "yo rindo mucho más a la mañana, de noche no me sale nada",
    expectation: { tasks: "none", savesFact: /ma[ñn]ana|horario|rendim/i, maxChars: 500 },
    toolsOnly: true
  },
  {
    name: "memoria: un dato de salud no se guarda",
    message: "tengo diabetes así que trato de comer cada 3 horas, agendame un recordatorio para el almuerzo mañana",
    // Sí crea el recordatorio (es lo que pidió); lo que no puede hacer es guardar el dato de salud.
    expectation: { tasks: "some", tool: "create_items", titles: ["almuerzo"], savesNoFact: true },
    toolsOnly: true
  },
  {
    name: "memoria: dinero y documentos tampoco",
    message: "cobro 900 mil por mes y mi dni es 30111222, ¿me ayudás a organizar la semana?",
    expectation: { tasks: "none", savesNoFact: true },
    toolsOnly: true
  },
  {
    name: "memoria: un plan de pasada no es un hecho",
    message: "mañana voy al gimnasio",
    expectation: { tasks: "some", tool: "create_items", titles: ["gimnasio"], savesNoFact: true },
    toolsOnly: true
  },
  {
    name: "memoria: pide que le recuerde algo sensible y Milo explica que no lo guarda",
    message: "acordate de que tomo pastillas para la presión",
    expectation: { tasks: "none", savesNoFact: true, maxChars: 500 },
    toolsOnly: true
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
