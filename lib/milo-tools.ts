import { adjustedEstimate, normalizeCategory, type UserPatterns } from "@/lib/user-patterns";
import type { Availability, AvailabilityOverrides } from "@/lib/availability";
import { capacityOn } from "@/lib/availability";
import type { ToolCall, ToolSpec } from "@/lib/ai/types";
import { addDays, daysBetween, isDateKey } from "@/lib/recurrence";
import { normalizeTaskAction } from "@/lib/task-actions";
import { quoteAppearsIn, validateFact, type UserFact } from "@/lib/user-facts";
import { describeDeferred, describeReason, describeWarning, formatMinutes, weekdayName } from "@/lib/week-plan-text";
import {
  MAX_WEEK_ITEMS,
  planWeek,
  WINDOW_DAYS,
  type ExistingEntry,
  type WeekItem,
  type WeekPlan
} from "@/lib/week-planner";
import type { FactProposal, ProposalItem, SavedFact, WeekProposal } from "@/types/milo";
import type { Task, TaskInput, TaskKind, TaskPriority } from "@/types/task";

/**
 * Las tools de Milo. Cada una valida sus argumentos acá, en el servidor, y devuelve dos
 * cosas: un JSON para el modelo (para que siga o se corrija) y, si corresponde, un efecto
 * para el cliente (ítems a confirmar, una propuesta semanal, una pregunta).
 *
 * Ninguna escribe en la base. `create_items` y `plan_week` proponen: crear sigue siendo el
 * botón de confirmar del usuario, con los mismos límites de plan de siempre.
 *
 * Los datos salen de `ToolContext.load`, que se arma con el usuario autenticado. Ningún
 * argumento del modelo decide de quién son los datos.
 */

export const CREATE_ITEMS_MAX = 20;
export const QUESTION_MAX = 300;
export const SCHEDULE_MAX_DAYS = 31;
const TITLE_MAX = 200;
const ITEMS_PER_DAY_SHOWN = 12;
/** Cuánto por delante están generadas las ocurrencias de las recurrentes (lib/series.ts). */
const RECURRING_KNOWN_DAYS = 14;

const KINDS: TaskKind[] = ["reminder", "task", "project"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

// ---------------------------------------------------------------------------
// Especificación (lo que ve el modelo)
// ---------------------------------------------------------------------------

const repeatSchema = {
  type: "object",
  description:
    "SOLO si se repite. Una recurrencia es UN ítem con repeat: el sistema genera las ocurrencias. dueDate es desde cuándo empieza.",
  properties: {
    freq: { type: "string", enum: ["daily", "weekly", "monthly"] },
    interval: { type: "integer", description: "cada cuántos días/semanas/meses (por defecto 1)" },
    weekdays: { type: "array", items: { type: "integer" }, description: "solo weekly. 0=domingo … 6=sábado" },
    monthDay: { type: "integer", description: "solo monthly. 1..31" },
    until: { type: "string", description: "YYYY-MM-DD, opcional" }
  },
  required: ["freq"]
};

const itemProperties = {
  title: { type: "string", description: "qué hay que hacer, corto" },
  kind: {
    type: "string",
    enum: KINDS,
    description: "reminder = acción de minutos (llamar, pagar); task = lleva un rato; project = algo grande con fecha lejana"
  },
  time: { type: "string", description: 'HH:MM. SOLO si el usuario dijo una hora' },
  estimateMin: { type: "integer", description: "minutos que lleva. Estimalo vos si no lo dijeron" },
  priority: { type: "string", enum: PRIORITIES },
  category: { type: "string" },
  repeat: repeatSchema
};

export const CREATE_ITEMS: ToolSpec = {
  name: "create_items",
  description:
    "Propone crear tareas o recordatorios. NO los crea: el usuario los confirma con un botón. Incluí TODOS los ítems del mensaje en una sola llamada.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: `1 a ${CREATE_ITEMS_MAX} ítems`,
        items: {
          type: "object",
          properties: { ...itemProperties, dueDate: { type: "string", description: "YYYY-MM-DD, resuelta con las fechas del contexto" } },
          required: ["title", "kind", "dueDate"]
        }
      }
    },
    required: ["items"]
  }
};

export const PLAN_WEEK: ToolSpec = {
  name: "plan_week",
  description:
    "Arma una propuesta de cómo repartir cosas en la semana, respetando la disponibilidad del usuario y lo que ya tiene agendado. NO crea nada. Los ítems sin dueDate son flexibles y se reparten; con dueDate quedan en esa fecha.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: `1 a ${MAX_WEEK_ITEMS} ítems`,
        items: {
          type: "object",
          properties: {
            ...itemProperties,
            dueDate: { type: "string", description: "YYYY-MM-DD. SOLO si tiene que ser ese día exacto (turno, examen). Si es flexible, omitilo" },
            deadline: { type: "string", description: "YYYY-MM-DD. Si es flexible pero tiene que estar hecho para un día, no después" }
          },
          required: ["title", "kind"]
        }
      },
      weekStart: {
        type: "string",
        description: `YYYY-MM-DD, primer día de los ${WINDOW_DAYS} a planificar. Por defecto hoy. Para "la semana que viene", el lunes que viene`
      }
    },
    required: ["items"]
  }
};

export const GET_SCHEDULE: ToolSpec = {
  name: "get_schedule",
  description:
    "Lo que el usuario ya tiene agendado entre dos fechas: tareas, ocurrencias, sesiones de proyecto y cuánto tiempo libre le queda por día. Usala para responder qué tiene un día o si le queda lugar.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD" },
      to: { type: "string", description: `YYYY-MM-DD, hasta ${SCHEDULE_MAX_DAYS} días después de from` }
    },
    required: ["from", "to"]
  }
};

export const ASK_USER: ToolSpec = {
  name: "ask_user",
  description:
    "Hace una pregunta corta cuando falta un dato NECESARIO para seguir y no se puede resolver con un valor razonable. No la uses para fechas u horas sueltas: ahí proponé con un default.",
  parameters: {
    type: "object",
    properties: { question: { type: "string", description: "una sola pregunta, en voseo" } },
    required: ["question"]
  }
};

export const REMEMBER_FACT: ToolSpec = {
  name: "remember_fact",
  description:
    "Guarda un dato que el usuario cuenta de sí mismo y sirve para organizarle la vida (hábitos, horarios en los que rinde, deportes, si es despistado). " +
    'Con source "stated" (lo dijo él) se guarda al instante y hay que copiar sus palabras textuales en quote. ' +
    'Con source "inferred" (lo dedujiste vos) NO se guarda: el usuario lo confirma con un botón. Nunca datos de salud, dinero, documentos, contactos, religión ni política.',
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "snake_case corta: es_despistado, horario_mejor_rendimiento, deportes…" },
      value: { type: "string", description: "el dato, en una línea corta" },
      source: { type: "string", enum: ["stated", "inferred"] },
      quote: { type: "string", description: 'solo con "stated": las palabras TEXTUALES del usuario en su mensaje de ahora' },
      confidence: { type: "number", description: 'solo con "inferred": 0.1 a 0.95' }
    },
    required: ["key", "value", "source"]
  }
};

export const GET_MY_PATTERNS: ToolSpec = {
  name: "get_my_patterns",
  description:
    "Lo que Spark aprendió de cómo trabaja el usuario: cuánto tarda de verdad respecto de lo que estima (en general y por categoría), en qué franja del día completa más tareas y qué posterga seguido. Usala para contestar \"¿cuánto tardo en estudiar?\" o \"¿cuándo rindo más?\". Los números salen del historial del usuario: no los inventes ni los recalcules.",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", description: "Opcional: solo esa categoría (por ejemplo la del tema por el que pregunta)." }
    },
    required: []
  }
};

export const MILO_TOOLS: ToolSpec[] = [CREATE_ITEMS, PLAN_WEEK, GET_SCHEDULE, ASK_USER, REMEMBER_FACT, GET_MY_PATTERNS];

/** Cuántos hechos puede tocar Milo en un mismo turno: un tope contra un modelo que "recuerda" todo. */
export const MAX_FACT_CALLS_PER_TURN = 3;

// ---------------------------------------------------------------------------
// Datos que las tools leen
// ---------------------------------------------------------------------------

export type ScheduleTask = Pick<
  Task,
  "title" | "kind" | "priority" | "estimateMin" | "dueDate" | "time" | "done" | "status" | "seriesId"
>;

export type ScheduleSession = { date: string; minutes: number; title: string };

export type ScheduleData = {
  tasks: readonly ScheduleTask[];
  sessions: readonly ScheduleSession[];
  availability: Availability;
  overrides: AvailabilityOverrides;
  /** Factor para la duración de los ítems nuevos. 1 = sin historial suficiente. */
  inflation: number;
  /** Factor de las categorías con medición propia. Sin la categoría, se usa `inflation`. */
  inflationByCategory?: Record<string, number>;
};

/** Lo que `remember_fact` necesita de la base, atado al usuario autenticado. */
export type FactsPort = {
  list: () => Promise<UserFact[]>;
  save: (input: { key: string; value: string; source: "stated"; confidence: 1 }) => Promise<{ status: "saved" | "exists_stated" | "limit" }>;
};

export type ToolContext = {
  /** Los patrones aprendidos del usuario autenticado (`lib/user-patterns.ts`). Se lee solo si se pide. */
  patterns?: () => Promise<UserPatterns>;
  /** El mensaje del usuario en este turno: `remember_fact` comprueba contra él que lo haya dicho. */
  userMessage?: string;
  facts?: FactsPort;
  /** Cuántas veces se llamó a remember_fact en este turno. */
  turn?: { factCalls: number };
  /** Hoy, en la zona del usuario. */
  today: string;
  now: Date;
  /** Lee la agenda del usuario autenticado. Se llama solo si una tool la necesita. */
  load: () => Promise<ScheduleData>;
};

export type ToolEffect = {
  /** Ítems para confirmar. */
  taskActions?: TaskInput[];
  proposal?: WeekProposal;
  /** Pregunta para el usuario: cierra el turno. */
  ask?: string;
  /** Un hecho guardado porque el usuario lo dijo. */
  factSaved?: SavedFact;
  /** Un hecho deducido: espera la confirmación del usuario. */
  factProposal?: FactProposal;
};

export type ToolOutcome = {
  /** JSON que se le devuelve al modelo. */
  content: string;
  effect?: ToolEffect;
  isError?: boolean;
};

const ok = (body: Record<string, unknown>, effect?: ToolEffect): ToolOutcome => ({
  content: JSON.stringify({ ok: true, ...body }),
  ...(effect ? { effect } : {})
});
const fail = (error: string, extra: Record<string, unknown> = {}): ToolOutcome => ({
  content: JSON.stringify({ ok: false, error, ...extra }),
  isError: true
});

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

export function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const value = raw.trim() === "" ? {} : (JSON.parse(raw) as unknown);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Rejected = { index: number; reason: string };

/** Lo común a los ítems de create_items y plan_week. Devuelve null y la razón si no sirve. */
function readItem(raw: unknown, ctx: ToolContext): { item: TaskInput; hadDate: boolean } | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "no es un objeto";
  const source = raw as Record<string, unknown>;
  const title = typeof source.title === "string" ? source.title.trim() : "";
  if (!title) return "falta el title";
  if (title.length > TITLE_MAX) return `title de más de ${TITLE_MAX} caracteres`;

  const hadDate = typeof source.dueDate === "string" && isDateKey(source.dueDate);
  if (typeof source.dueDate === "string" && source.dueDate.trim() !== "" && !hadDate) {
    return `dueDate "${source.dueDate}" no es una fecha YYYY-MM-DD válida`;
  }
  if (typeof source.time === "string" && source.time.trim() !== "" && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(source.time)) {
    return `time "${source.time}" no es HH:MM`;
  }

  // Los mismos defaults y las mismas reglas que el camino de texto: un ítem creado por
  // chat y uno creado a mano tienen que salir iguales.
  const item = normalizeTaskAction({ ...source, title }, ctx.now);
  if (!item) return "ítem inválido";
  return { item, hadDate };
}

// ---------------------------------------------------------------------------
// create_items
// ---------------------------------------------------------------------------

function createItems(args: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  if (!Array.isArray(args.items) || args.items.length === 0) return fail("items tiene que ser una lista con al menos un ítem");
  if (args.items.length > CREATE_ITEMS_MAX) {
    return fail(`Máximo ${CREATE_ITEMS_MAX} ítems por llamada. Mandá los más importantes y avisale al usuario que hay más.`);
  }

  const taskActions: TaskInput[] = [];
  const rejected: Rejected[] = [];
  args.items.forEach((raw, index) => {
    const result = readItem(raw, ctx);
    if (typeof result === "string") rejected.push({ index, reason: result });
    else taskActions.push(result.item);
  });

  if (taskActions.length === 0) return fail("Ningún ítem es válido", { rejected });

  return ok(
    {
      proposed: taskActions.map((t) => ({
        title: t.title,
        kind: t.kind,
        dueDate: t.dueDate,
        ...(t.time ? { time: t.time } : {}),
        ...(t.repeat ? { repeat: t.repeat.freq } : {})
      })),
      ...(rejected.length > 0 ? { rejected } : {}),
      note: "Todavía no se creó nada: el usuario tiene que confirmar. Decíselo como propuesta, no como hecho."
    },
    { taskActions }
  );
}

// ---------------------------------------------------------------------------
// get_schedule y datos compartidos con plan_week
// ---------------------------------------------------------------------------

const isPending = (task: ScheduleTask) => !task.done && task.status !== "skipped";

/** Lo ya agendado, como lo entiende el planificador. Los proyectos entran por sus sesiones. */
export function existingEntries(data: ScheduleData): ExistingEntry[] {
  const entries: ExistingEntry[] = [];
  for (const task of data.tasks) {
    if (task.kind === "project" || !isPending(task)) continue;
    entries.push({ date: task.dueDate, title: task.title, minutes: task.estimateMin, priority: task.priority });
  }
  for (const session of data.sessions) {
    entries.push({ date: session.date, title: session.title, minutes: session.minutes });
  }
  return entries;
}

function readRange(args: Record<string, unknown>): { from: string; to: string } | ToolOutcome {
  const { from, to } = args;
  if (typeof from !== "string" || !isDateKey(from)) return fail("from tiene que ser una fecha YYYY-MM-DD");
  if (typeof to !== "string" || !isDateKey(to)) return fail("to tiene que ser una fecha YYYY-MM-DD");
  if (to < from) return fail("to no puede ser anterior a from");
  const span = daysBetween(from, to) + 1;
  if (span > SCHEDULE_MAX_DAYS) return fail(`El rango máximo es de ${SCHEDULE_MAX_DAYS} días; pediste ${span}`);
  return { from, to };
}

function getSchedule(range: { from: string; to: string }, ctx: ToolContext, data: ScheduleData): ToolOutcome {
  const { from, to } = range;
  const span = daysBetween(from, to) + 1;

  const days = [];
  for (let offset = 0; offset < span; offset += 1) {
    const date = addDays(from, offset);
    const items: Array<Record<string, unknown>> = [];
    let plannedMin = 0;

    for (const task of data.tasks) {
      if (!isPending(task) || task.kind === "project") continue;
      // Lo vencido cuenta hoy: es lo que el usuario tiene encima ese día.
      const at = task.dueDate < ctx.today ? ctx.today : task.dueDate;
      if (at !== date) continue;
      plannedMin += task.estimateMin;
      items.push({
        title: task.title,
        kind: task.kind,
        minutes: task.estimateMin,
        priority: task.priority,
        ...(task.time ? { time: task.time } : {}),
        ...(task.seriesId ? { recurring: true } : {}),
        ...(task.dueDate < ctx.today ? { overdue: true } : {})
      });
    }
    for (const session of data.sessions) {
      if (session.date !== date) continue;
      plannedMin += session.minutes;
      items.push({ title: session.title, kind: "project_session", minutes: session.minutes });
    }

    const capacityMin = capacityOn(date, data.availability, data.overrides);
    days.push({
      date,
      weekday: weekdayName(date, "es"),
      capacityMin,
      plannedMin,
      freeMin: Math.max(0, capacityMin - plannedMin),
      items: items.slice(0, ITEMS_PER_DAY_SHOWN),
      ...(items.length > ITEMS_PER_DAY_SHOWN ? { moreItems: items.length - ITEMS_PER_DAY_SHOWN } : {})
    });
  }

  const knownUntil = addDays(ctx.today, RECURRING_KNOWN_DAYS - 1);
  return ok({
    today: ctx.today,
    days,
    ...(to > knownUntil
      ? { note: `Las tareas que se repiten solo están generadas hasta el ${knownUntil}; más allá de esa fecha puede faltar alguna.` }
      : {})
  });
}

// ---------------------------------------------------------------------------
// plan_week
// ---------------------------------------------------------------------------

const MAX_WEEKS_AHEAD = 8;

type PlanRequest = { weekStart: string; items: WeekItem[]; rejected: Rejected[] };

function readPlanRequest(args: Record<string, unknown>, ctx: ToolContext): PlanRequest | ToolOutcome {
  if (!Array.isArray(args.items) || args.items.length === 0) return fail("items tiene que ser una lista con al menos un ítem");
  if (args.items.length > MAX_WEEK_ITEMS) {
    return fail(`Máximo ${MAX_WEEK_ITEMS} ítems por semana. Mandá los más importantes y avisale al usuario que hay más.`);
  }

  let weekStart = ctx.today;
  if (args.weekStart !== undefined && args.weekStart !== null && args.weekStart !== "") {
    if (typeof args.weekStart !== "string" || !isDateKey(args.weekStart)) return fail("weekStart tiene que ser una fecha YYYY-MM-DD");
    weekStart = args.weekStart;
  }
  if (addDays(weekStart, WINDOW_DAYS - 1) < ctx.today) return fail("Esa semana ya pasó");
  if (weekStart > addDays(ctx.today, MAX_WEEKS_AHEAD * 7)) return fail(`Solo se puede planificar hasta ${MAX_WEEKS_AHEAD} semanas adelante`);

  const items: WeekItem[] = [];
  const rejected: Rejected[] = [];
  args.items.forEach((raw, index) => {
    const result = readItem(raw, ctx);
    if (typeof result === "string") {
      rejected.push({ index, reason: result });
      return;
    }
    const { item, hadDate } = result;
    if (item.kind === "project") {
      rejected.push({ index, reason: "un proyecto no se reparte en una semana: se arma desde Nueva tarea → Proyecto" });
      return;
    }
    const source = raw as Record<string, unknown>;
    const deadline = typeof source.deadline === "string" && isDateKey(source.deadline) ? source.deadline : undefined;
    items.push({
      title: item.title,
      kind: item.kind,
      estimateMin: item.estimateMin,
      priority: item.priority,
      category: item.category,
      ...(item.time ? { time: item.time } : {}),
      ...(hadDate ? { dueDate: item.dueDate } : {}),
      ...(!hadDate && deadline ? { deadline } : {}),
      ...(item.repeat ? { repeat: item.repeat } : {})
    });
  });

  if (items.length === 0) return fail("Ningún ítem es válido", { rejected });
  return { weekStart, items, rejected };
}

function planWeekTool(request: PlanRequest, ctx: ToolContext, data: ScheduleData): ToolOutcome {
  const { weekStart, items, rejected } = request;
  const plan = planWeek({
    today: ctx.today,
    weekStart,
    availability: data.availability,
    overrides: data.overrides,
    existing: existingEntries(data),
    items,
    inflation: data.inflation,
    inflationByCategory: data.inflationByCategory
  });

  const proposal = toProposal(plan);
  const taskActions = proposalTaskActions(plan, ctx);

  return ok(
    {
      weekStart,
      days: proposal.days.map((day) => ({
        date: day.date,
        weekday: weekdayName(day.date, "es"),
        used: `${formatMinutes(day.existingMin + day.plannedMin)} de ${formatMinutes(day.capacityMin)}`,
        light: day.light,
        alreadyPlanned: formatMinutes(day.existingMin),
        items: day.items.map((item) => ({
          title: item.title,
          minutes: item.estimateMin,
          why: describeReason(item.reason, "es")
        }))
      })),
      ...(proposal.outside.length > 0
        ? { onOtherDates: proposal.outside.map((item) => ({ title: item.title, date: item.date })) }
        : {}),
      ...(proposal.deferred.length > 0
        ? {
            doesNotFit: proposal.deferred.map((d) => ({
              title: d.title,
              priority: d.priority,
              why: describeDeferred(d, "es")
            }))
          }
        : {}),
      ...(proposal.warnings.length > 0 ? { warnings: proposal.warnings.map((w) => describeWarning(w, "es")) } : {}),
      ...(rejected.length > 0 ? { rejected } : {}),
      note:
        "Es una propuesta: todavía no se creó nada. El usuario la ve como tarjeta con los días y las razones, así que no repitas el listado: contá en pocas frases lo importante y por qué. Ofrecele confirmar o cambiar algo."
    },
    { proposal, taskActions }
  );
}

const itemView = (placed: WeekPlan["placed"][number]): ProposalItem => ({
  title: placed.item.title,
  kind: placed.item.kind,
  priority: placed.item.priority,
  estimateMin: placed.item.estimateMin,
  date: placed.date,
  ...(placed.reason.dates ? { dates: placed.reason.dates } : {}),
  fixed: placed.fixed,
  reason: placed.reason
});

export function toProposal(plan: WeekPlan): WeekProposal {
  return {
    weekStart: plan.weekStart,
    days: plan.days.map((day) => ({
      date: day.date,
      capacityMin: day.capacityMin,
      existingMin: day.existingMin,
      plannedMin: day.plannedMin,
      loadPct: day.loadPct,
      light: day.light,
      items: day.placed.map((i) => itemView(plan.placed[i]))
    })),
    outside: plan.placed.filter((p) => p.outsideWindow).map(itemView),
    deferred: plan.deferred.map((d) => ({
      title: d.item.title,
      estimateMin: d.item.estimateMin,
      priority: d.item.priority,
      code: d.code,
      neededMin: d.neededMin,
      freeMin: d.freeMin,
      suggestedDate: d.suggestedDate
    })),
    warnings: plan.warnings.map((w) =>
      w.code === "DEADLINE_AT_RISK"
        ? { code: w.code, title: plan.deferred.find((d) => d.index === w.index)?.item.title ?? "", deadline: w.deadline }
        : w
    )
  };
}

/** Lo que se crea si el usuario confirma: cada ítem colocado, con la fecha que le tocó. */
export function proposalTaskActions(plan: WeekPlan, ctx: Pick<ToolContext, "now">): TaskInput[] {
  const actions: TaskInput[] = [];
  for (const placed of [...plan.placed].sort((a, b) => a.index - b.index)) {
    const item = placed.item;
    const action = normalizeTaskAction(
      {
        title: item.title,
        kind: item.kind,
        dueDate: placed.date,
        time: item.time,
        estimateMin: item.estimateMin,
        priority: item.priority,
        category: item.category,
        repeat: item.repeat
      },
      ctx.now
    );
    if (action) actions.push(action);
  }
  return actions;
}

// ---------------------------------------------------------------------------
// ask_user y despacho
// ---------------------------------------------------------------------------

function askUser(args: Record<string, unknown>): ToolOutcome {
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) return fail("question no puede estar vacía");
  if (question.length > QUESTION_MAX) return fail(`La pregunta es muy larga (máximo ${QUESTION_MAX} caracteres). Hacela más corta.`);
  return ok({ asked: true }, { ask: question });
}

// ---------------------------------------------------------------------------
// remember_fact
// ---------------------------------------------------------------------------

/**
 * La única tool que escribe. Lo hace bajo condiciones que el servidor comprueba y no el modelo:
 * el hecho pasa el filtro de datos sensibles, y si es `stated` el usuario tiene que haberlo dicho
 * de verdad (`quote` aparece en su mensaje). Lo deducido nunca se guarda desde acá.
 */
async function rememberFact(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.facts) return fail("La memoria no está disponible ahora. Seguí sin guardar nada.");
  if (ctx.turn && ctx.turn.factCalls >= MAX_FACT_CALLS_PER_TURN) {
    return fail(`Solo se pueden guardar ${MAX_FACT_CALLS_PER_TURN} datos por mensaje.`);
  }
  if (ctx.turn) ctx.turn.factCalls += 1;

  const source = args.source;
  if (source !== "stated" && source !== "inferred") return fail('source tiene que ser "stated" o "inferred"');

  const check = validateFact({ key: args.key, value: args.value });
  if (!check.ok) {
    if (check.reason === "sensitive") {
      return fail(
        "Ese tipo de dato (salud, dinero, documentos, contacto, creencias) no se guarda. No lo guardes ni lo propongas; si el usuario te lo pidió, decile con amabilidad que Spark no guarda eso.",
        { saved: false }
      );
    }
    return fail(check.reason === "key" ? "key inválida: usá snake_case corta, por ejemplo deportes" : "value vacío o de más de 200 caracteres");
  }

  if (source === "inferred") {
    const known = (await ctx.facts.list()).find((f) => f.key === check.key);
    if (known && (known.source === "stated" || known.value === check.value)) {
      return ok({ saved: false, note: "Eso ya lo sabemos: no hace falta proponerlo." });
    }
    const raw = typeof args.confidence === "number" && Number.isFinite(args.confidence) ? args.confidence : 0.6;
    const confidence = Math.min(0.95, Math.max(0.1, raw));
    return ok(
      { saved: false, note: "Todavía NO está guardado: el usuario lo confirma con un botón. Preguntale si querés que te acuerdes, no lo des por hecho." },
      { factProposal: { key: check.key, value: check.value, confidence } }
    );
  }

  if (!ctx.userMessage || !quoteAppearsIn(args.quote, ctx.userMessage)) {
    return fail(
      'El usuario no dijo eso con esas palabras en este mensaje, así que no se guarda como "stated". Si lo dedujiste vos, usá source "inferred".',
      { saved: false }
    );
  }

  const result = await ctx.facts.save({ key: check.key, value: check.value, source: "stated", confidence: 1 });
  if (result.status === "limit") return fail("Ya hay demasiados datos guardados. El usuario puede borrar alguno en «Lo que Spark sabe de vos».", { saved: false });
  return ok({ saved: true, note: "Guardado. Podés decirle que lo tenés en cuenta." }, { factSaved: { key: check.key, value: check.value } });
}

const PATTERN_LIST_MAX = 5;

/**
 * Devuelve los patrones ya calculados. La IA solo los redacta: cada número sale de
 * `lib/user-patterns.ts`, y lo que todavía no se aprendió se dice como tal ("faltan N").
 */
async function getMyPatterns(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.patterns) return fail("No hay patrones disponibles.");
  const wanted = typeof args.category === "string" && args.category.trim() ? normalizeCategory(args.category) : null;
  const patterns = await ctx.patterns();
  const { inflation, hours, postponers } = patterns;

  const describe = (category: string, entry: (typeof inflation.categories)[string]) => ({
    category,
    factor: entry.factor,
    samples: entry.samples,
    learned: entry.learned,
    source: entry.source,
    // 30 minutos estimados, cuánto suele llevarle de verdad (para que no haya que hacer la cuenta).
    minutesFor30Estimated: adjustedEstimate(30, entry.factor)
  });
  const categories = Object.entries(inflation.categories)
    .filter(([category]) => !wanted || category === wanted)
    .map(([category, entry]) => describe(category, entry));

  return ok({
    timeEstimates: {
      overall: { ...inflation.global, minutesFor30Estimated: adjustedEstimate(30, inflation.global.factor) },
      ...(wanted && categories.length === 0
        ? { category: wanted, categoryNote: "Todavía no hay tareas medidas en esa categoría: se usa el factor general." }
        : {}),
      categories,
      measuredNeeded: patterns.measuredNeeded,
      note: "factor = cuántas veces lo estimado suele llevarle de verdad (1.5 = un 50% más). Solo cuentan las tareas hechas con el modo foco."
    },
    productiveHours: {
      learned: hours.learned,
      needed: hours.needed,
      completedWithKnownHour: hours.total,
      bestPart: hours.best,
      sharesPercent: hours.shares
    },
    postponements: {
      tasks: postponers.tasks.slice(0, PATTERN_LIST_MAX),
      categories: postponers.categories.slice(0, PATTERN_LIST_MAX)
    }
  });
}

/** Tools que devuelven datos y no cierran el turno: el modelo puede seguir con otra. */
export const READ_ONLY_TOOLS = new Set(["get_schedule", "get_my_patterns"]);

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolOutcome> {
  const args = parseArguments(call.arguments);
  if (!args) return fail("Los argumentos no son un objeto JSON válido. Volvé a llamar la tool con JSON correcto.");

  try {
    switch (call.name) {
      case "create_items":
        return createItems(args, ctx);
      case "ask_user":
        return askUser(args);
      case "remember_fact":
        return await rememberFact(args, ctx);
      case "get_schedule": {
        // Se valida antes de tocar la base: una llamada mal armada no cuesta una consulta.
        const range = readRange(args);
        return "content" in range ? range : getSchedule(range, ctx, await ctx.load());
      }
      case "get_my_patterns":
        return await getMyPatterns(args, ctx);
      case "plan_week": {
        const request = readPlanRequest(args, ctx);
        return "content" in request ? request : planWeekTool(request, ctx, await ctx.load());
      }
      default:
        return fail(`No existe la tool "${call.name}". Las disponibles son: ${MILO_TOOLS.map((t) => t.name).join(", ")}.`);
    }
  } catch (error) {
    // Un fallo de la base no debe tirar el turno entero: el modelo puede contestar sin el dato.
    console.error(`[milo] tool ${call.name} failed`, error);
    return fail("No se pudo leer la agenda ahora. Respondé sin ese dato y decilo.");
  }
}
