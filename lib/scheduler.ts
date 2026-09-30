import {
  capacityOn,
  type Availability,
  type AvailabilityOverrides
} from "@/lib/availability";
import { DEFAULT_INFLATION } from "@/lib/estimate-learning";
import { addDays, daysBetween, isDateKey } from "@/lib/recurrence";

/**
 * Scheduler determinístico de proyectos.
 *
 * Puro: no toca la base ni el reloj, todo entra por parámetro, y el mismo input
 * da siempre el mismo output. La IA (etapa 3) dice qué subtareas hay y cuánto
 * duran; este módulo decide CUÁNDO. Ver "Etapa 2" en docs/roadmap.md.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type SchedulerSubtask = {
  id: string;
  estimateMin: number;
  /** Ids de otras subtareas del MISMO proyecto que tienen que terminar antes. */
  dependsOn: string[];
  done: boolean;
  /** Minutos ya trabajados. Se descuentan de lo que falta. */
  actualMin?: number;
};

export type SchedulerProject = {
  id: string;
  /** "YYYY-MM-DD". El día del deadline todavía se puede trabajar. */
  deadline: string;
  /** Tope diario propio del proyecto. Sin valor = sin tope propio. */
  dailyCapMin?: number | null;
  subtasks: SchedulerSubtask[];
};

export type SchedulerParams = {
  /** Multiplica cada estimación. */
  inflation: number;
  /** Qué parte del camino a la fecha límite debería estar todo hecho. */
  targetFraction: number;
  maxSessionMin: number;
  minSessionMin: number;
};

export const DEFAULT_PARAMS: SchedulerParams = {
  inflation: DEFAULT_INFLATION,
  targetFraction: 0.85,
  maxSessionMin: 90,
  minSessionMin: 20
};

export type ScheduleInput = {
  today: string;
  availability: Availability;
  overrides?: AvailabilityOverrides;
  projects: SchedulerProject[];
  /** Minutos ya ocupados por fecha (tareas y ocurrencias normales). */
  fixedLoad?: Record<string, number>;
  params?: Partial<SchedulerParams>;
};

export type Session = {
  subtaskId: string;
  projectId: string;
  date: string;
  minutes: number;
  /** 1-based, ordenadas por fecha. */
  part: number;
  totalParts: number;
};

export type WarningCode = "INFEASIBLE" | "TIGHT" | "OVERLOADED_DAY" | "CYCLE";

export type SchedulerWarning = {
  code: WarningCode;
  message: string;
  projectId?: string;
  date?: string;
};

export type InfeasibleOptions = {
  /**
   * Minutos extra por día, en los días con disponibilidad, con los que sí
   * entraría. null si ni con 24 h por día alcanza (por ejemplo, una cadena de
   * dependencias más larga que los días que hay).
   */
  extraMinPerDay: number | null;
  /** La fecha límite más cercana que alcanzaría con la disponibilidad actual. */
  achievableDeadline: string | null;
};

export type ProjectPlan = {
  feasible: boolean;
  /** Fecha de la última sesión, o null si no hay nada que agendar. */
  plannedEndDate: string | null;
  /** deadline - plannedEndDate, en días. Sin sesiones: deadline - today. */
  bufferDays: number;
  /** Minutos que no entran antes del deadline. */
  shortfallMin: number;
  /** Cuánto del margen entre la fecha objetivo y el deadline ya se gastó (0..100). */
  bufferConsumedPct: number;
  targetDate: string;
  /** Solo cuando no es factible. */
  options?: InfeasibleOptions;
};

export type ScheduleOutput = {
  sessions: Session[];
  perProject: Record<string, ProjectPlan>;
  warnings: SchedulerWarning[];
};

export type SchedulerErrorCode =
  | "CYCLE"
  | "UNKNOWN_DEPENDENCY"
  | "DUPLICATE_ID"
  | "INVALID_INPUT";

export class SchedulerError extends Error {
  readonly code: SchedulerErrorCode;
  constructor(code: SchedulerErrorCode, message: string) {
    super(message);
    this.name = "SchedulerError";
    this.code = code;
  }
}

export class SchedulerCycleError extends SchedulerError {
  /** Los ids que forman el ciclo, con el primero repetido al final. */
  readonly cycle: string[];
  constructor(projectId: string, cycle: string[]) {
    super("CYCLE", `Circular dependency in project ${projectId}: ${cycle.join(" -> ")}`);
    this.name = "SchedulerCycleError";
    this.cycle = cycle;
  }
}

// ---------------------------------------------------------------------------
// Constantes y helpers
// ---------------------------------------------------------------------------

/** Nada legítimo planifica más allá de esto; evita recorrer una fecha absurda. */
const MAX_HORIZON_DAYS = 3660;
/** Tope del buscador de "fecha alcanzable". */
const MAX_DEADLINE_EXTENSION_DAYS = 730;
const MAX_EXTRA_PER_DAY = 24 * 60;
const TIGHT_THRESHOLD_PCT = 50;

/**
 * ceil() tolerante al error de coma flotante: 100 * 1.3 es 130.00000000000003 y
 * un ceil directo daría 131, una duración que nadie pidió.
 */
function ceilStable(value: number): number {
  return Math.ceil(Math.round(value * 1e6) / 1e6);
}

/** Duración efectiva de una subtarea: la estimación inflada. */
export function effectiveMinutes(estimateMin: number, inflation: number): number {
  return ceilStable(estimateMin * inflation);
}

/**
 * Fecha objetivo: `today + floor((deadline - today) * targetFraction)` días, y
 * nunca después de `deadline - 1` si faltan al menos dos días. Con el deadline
 * hoy, mañana o ya vencido, el objetivo es hoy.
 */
export function targetDate(today: string, deadline: string, targetFraction: number): string {
  const days = daysBetween(today, deadline);
  if (days <= 0) return today;
  let offset = Math.floor(days * targetFraction + 1e-9);
  if (days >= 2) offset = Math.min(offset, days - 1);
  return addDays(today, Math.max(0, offset));
}

function resolveParams(partial: Partial<SchedulerParams> | undefined): SchedulerParams {
  const merged = { ...DEFAULT_PARAMS, ...partial };
  const inflation =
    Number.isFinite(merged.inflation) && merged.inflation > 0 ? merged.inflation : DEFAULT_PARAMS.inflation;
  const targetFraction =
    Number.isFinite(merged.targetFraction) && merged.targetFraction > 0
      ? Math.min(1, merged.targetFraction)
      : DEFAULT_PARAMS.targetFraction;
  const maxSessionMin = Math.max(
    1,
    Number.isFinite(merged.maxSessionMin) ? Math.floor(merged.maxSessionMin) : DEFAULT_PARAMS.maxSessionMin
  );
  // Con un mínimo mayor que la mitad del máximo, partir una subtarea no podría
  // respetar los dos límites a la vez: el mínimo se acota.
  const minRaw = Number.isFinite(merged.minSessionMin) ? Math.floor(merged.minSessionMin) : DEFAULT_PARAMS.minSessionMin;
  const minSessionMin = Math.max(1, Math.min(minRaw, Math.floor(maxSessionMin / 2)));
  return { inflation, targetFraction, maxSessionMin, minSessionMin };
}

// ---------------------------------------------------------------------------
// Modelo interno
// ---------------------------------------------------------------------------

type Node = {
  /** Posición original: desempate final y orden estable de la salida. */
  order: number;
  id: string;
  projectIdx: number;
  /** Índices de las dependencias todavía sin hacer. */
  deps: number[];
  /** Minutos que faltan al empezar (0 si está hecha). */
  need: number;
  slack: number;
};

type Model = {
  today: string;
  params: SchedulerParams;
  availability: Availability;
  overrides: AvailabilityOverrides;
  fixedLoad: Record<string, number>;
  projects: SchedulerProject[];
  nodes: Node[];
  /** Un extra por día aplicado a los días con disponibilidad (solo para las opciones). */
  extraPerDay: number;
};

function assertDate(value: string, label: string): void {
  if (!isDateKey(value)) throw new SchedulerError("INVALID_INPUT", `${label} is not a valid date: ${String(value)}`);
}

/** Busca un ciclo entre las dependencias de un proyecto. */
function findCycle(subtasks: SchedulerSubtask[]): string[] | null {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const state = new Map<string, 0 | 1 | 2>(); // 1 = en la pila, 2 = terminado
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (state.get(dep) === 1) return [...stack.slice(stack.indexOf(dep)), dep];
      if (state.get(dep) === undefined) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };

  for (const subtask of subtasks) {
    if (state.get(subtask.id) === undefined) {
      const cycle = visit(subtask.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

function validate(input: ScheduleInput): void {
  assertDate(input.today, "today");
  const seen = new Set<string>();
  const projectIds = new Set<string>();

  for (const project of input.projects) {
    if (projectIds.has(project.id)) {
      throw new SchedulerError("DUPLICATE_ID", `Duplicate project id: ${project.id}`);
    }
    projectIds.add(project.id);
    assertDate(project.deadline, `deadline of ${project.id}`);
    if (
      project.dailyCapMin !== undefined &&
      project.dailyCapMin !== null &&
      !(Number.isInteger(project.dailyCapMin) && project.dailyCapMin >= 1)
    ) {
      throw new SchedulerError("INVALID_INPUT", `dailyCapMin of ${project.id} must be a positive integer`);
    }

    const ids = new Set(project.subtasks.map((s) => s.id));
    for (const subtask of project.subtasks) {
      if (seen.has(subtask.id)) {
        throw new SchedulerError("DUPLICATE_ID", `Duplicate subtask id: ${subtask.id}`);
      }
      seen.add(subtask.id);
      if (!Number.isInteger(subtask.estimateMin) || subtask.estimateMin < 1) {
        throw new SchedulerError("INVALID_INPUT", `estimateMin of ${subtask.id} must be a positive integer`);
      }
      for (const dep of subtask.dependsOn) {
        if (!ids.has(dep)) {
          throw new SchedulerError(
            "UNKNOWN_DEPENDENCY",
            `Subtask ${subtask.id} depends on ${dep}, which is not in project ${project.id}`
          );
        }
      }
    }

    const cycle = findCycle(project.subtasks);
    if (cycle) throw new SchedulerCycleError(project.id, cycle);
  }
}

/** Capacidad de un día tras restar la carga fija. */
function capacity(model: Model, date: string): number {
  const base = capacityOn(date, model.availability, model.overrides);
  const withExtra = base > 0 ? Math.min(MAX_EXTRA_PER_DAY, base + model.extraPerDay) : 0;
  return Math.max(0, withExtra - (model.fixedLoad[date] ?? 0));
}

/** Último día que hay que recorrer: el mayor deadline con trabajo pendiente. */
function lastDayOf(model: Model): string | null {
  let last: string | null = null;
  for (const node of model.nodes) {
    if (node.need <= 0) continue;
    const deadline = model.projects[node.projectIdx].deadline;
    if (last === null || deadline > last) last = deadline;
  }
  if (last === null || last < model.today) return null;
  const horizon = addDays(model.today, MAX_HORIZON_DAYS);
  return last > horizon ? horizon : last;
}

function buildModel(input: ScheduleInput, change?: { extraPerDay?: number; deadlines?: Record<string, string> }): Model {
  const params = resolveParams(input.params);
  const projects = input.projects.map((p) =>
    change?.deadlines?.[p.id] ? { ...p, deadline: change.deadlines[p.id] } : p
  );

  const nodes: Node[] = [];
  const indexById = new Map<string, number>();
  projects.forEach((project, projectIdx) => {
    for (const subtask of project.subtasks) {
      const effective = effectiveMinutes(subtask.estimateMin, params.inflation);
      const worked = Math.max(0, subtask.actualMin ?? 0);
      indexById.set(subtask.id, nodes.length);
      nodes.push({
        order: nodes.length,
        id: subtask.id,
        projectIdx,
        deps: [],
        need: subtask.done ? 0 : Math.max(1, effective - worked),
        slack: 0
      });
    }
  });

  // Solo cuentan las dependencias que faltan: una ya hecha no bloquea nada.
  projects.forEach((project) => {
    for (const subtask of project.subtasks) {
      const node = nodes[indexById.get(subtask.id) as number];
      node.deps = subtask.dependsOn
        .map((dep) => indexById.get(dep) as number)
        .filter((index) => nodes[index].need > 0);
    }
  });

  const model: Model = {
    today: input.today,
    params,
    availability: input.availability,
    overrides: input.overrides ?? {},
    fixedLoad: input.fixedLoad ?? {},
    projects,
    nodes,
    extraPerDay: change?.extraPerDay ?? 0
  };
  computeSlack(model);
  return model;
}

/**
 * Holgura estilo CPM medida en minutos de capacidad acumulada.
 *
 * Se mide en minutos de trabajo disponibles y no en días para que sea comparable
 * entre proyectos: 100 minutos de holgura son lo mismo para cualquiera, mientras
 * que "3 días" depende de qué días tenga cada uno. `holgura = latestStart -
 * earliestStart`; cuanto menor, más urgente. Es estática: se calcula una vez
 * desde hoy, con todo lo que falta, sin importar qué se clave después.
 */
function computeSlack(model: Model): void {
  const { nodes, projects, today, params } = model;
  const last = lastDayOf(model);

  // Capacidad acumulada por día, desde hoy.
  const cumulative = new Map<string, number>();
  if (last !== null) {
    let running = 0;
    for (let offset = 0; offset <= daysBetween(today, last); offset += 1) {
      const date = addDays(today, offset);
      running += capacity(model, date);
      cumulative.set(date, running);
    }
  }
  const cumulativeAt = (date: string): number => {
    if (last === null || date < today) return 0;
    return cumulative.get(date > last ? last : date) ?? 0;
  };

  // Orden topológico global (las dependencias solo cruzan dentro de un proyecto).
  const order: number[] = [];
  const visited = new Set<number>();
  const visit = (index: number) => {
    if (visited.has(index)) return;
    visited.add(index);
    for (const dep of nodes[index].deps) visit(dep);
    order.push(index);
  };
  nodes.forEach((_, index) => visit(index));

  const earliestFinish = new Map<number, number>();
  const earliestStart = new Map<number, number>();
  for (const index of order) {
    const node = nodes[index];
    if (node.need <= 0) continue;
    const start = Math.max(0, ...node.deps.map((dep) => earliestFinish.get(dep) ?? 0));
    earliestStart.set(index, start);
    earliestFinish.set(index, start + node.need);
  }

  const successors = new Map<number, number[]>();
  for (const index of order) {
    if (nodes[index].need <= 0) continue;
    for (const dep of nodes[index].deps) successors.set(dep, [...(successors.get(dep) ?? []), index]);
  }

  const latestStart = new Map<number, number>();
  for (const index of [...order].reverse()) {
    const node = nodes[index];
    if (node.need <= 0) continue;
    const project = projects[node.projectIdx];
    const goal = cumulativeAt(targetDate(today, project.deadline, params.targetFraction));
    const latestFinish = Math.min(goal, ...(successors.get(index) ?? []).map((s) => latestStart.get(s) ?? goal));
    latestStart.set(index, latestFinish - node.need);
  }

  for (const index of order) {
    const node = nodes[index];
    node.slack = node.need > 0 ? (latestStart.get(index) ?? 0) - (earliestStart.get(index) ?? 0) : 0;
  }
}

// ---------------------------------------------------------------------------
// Relleno hacia adelante
// ---------------------------------------------------------------------------

type RawSession = { nodeIndex: number; date: string; minutes: number };

type CoreResult = {
  sessions: RawSession[];
  /** Minutos que faltaron por agendar, por proyecto. */
  shortfall: number[];
};

/**
 * Cuánto agendar hoy de una subtarea a la que le faltan `remaining` minutos y
 * hoy hay `room` de lugar. 0 = no entra hoy.
 *
 * Si parte la subtarea, ninguna sesión puede quedar bajo el mínimo salvo la
 * última; si la parte que sobraría fuera menor que el mínimo, se le quita a esta
 * sesión lo necesario para que la última no quede diminuta.
 */
function pickAmount(remaining: number, room: number, params: SchedulerParams): number {
  let amount = Math.min(remaining, room, params.maxSessionMin);
  if (amount <= 0) return 0;
  if (amount === remaining) return amount;

  if (remaining - amount < params.minSessionMin) amount = remaining - params.minSessionMin;
  return amount >= params.minSessionMin ? amount : 0;
}

/**
 * Llena los días desde hoy hacia el deadline. Cada día, entre las subtareas
 * disponibles va primero la de menor holgura; a lo sumo una sesión por subtarea
 * y por día; una subtarea está disponible cuando todas sus dependencias están
 * agendadas por completo en días ANTERIORES.
 */
function fill(model: Model, pins: RawSession[] = []): CoreResult {
  const { nodes, projects, today, params } = model;
  const remaining = nodes.map((n) => n.need);
  const lastDate: (string | null)[] = nodes.map(() => null);
  const usedDays: Set<string>[] = nodes.map(() => new Set());
  const projectUsed = new Map<string, number>(); // `${projectIdx}|${date}` -> minutos
  const usedCapacity = new Map<string, number>(); // date -> minutos
  const sessions: RawSession[] = [];

  const place = (nodeIndex: number, date: string, minutes: number) => {
    const projectIdx = nodes[nodeIndex].projectIdx;
    remaining[nodeIndex] -= minutes;
    if (lastDate[nodeIndex] === null || date > (lastDate[nodeIndex] as string)) lastDate[nodeIndex] = date;
    usedDays[nodeIndex].add(date);
    usedCapacity.set(date, (usedCapacity.get(date) ?? 0) + minutes);
    const key = `${projectIdx}|${date}`;
    projectUsed.set(key, (projectUsed.get(key) ?? 0) + minutes);
    sessions.push({ nodeIndex, date, minutes });
  };

  for (const pin of pins) place(pin.nodeIndex, pin.date, pin.minutes);

  const last = lastDayOf(model);
  if (last !== null) {
    const priority = (a: number, b: number): number => {
      const na = nodes[a];
      const nb = nodes[b];
      if (na.slack !== nb.slack) return na.slack - nb.slack;
      const da = projects[na.projectIdx].deadline;
      const db = projects[nb.projectIdx].deadline;
      if (da !== db) return da < db ? -1 : 1;
      return na.order - nb.order;
    };

    for (let offset = 0; offset <= daysBetween(today, last); offset += 1) {
      const date = addDays(today, offset);
      let room = capacity(model, date) - (usedCapacity.get(date) ?? 0);
      if (room <= 0) continue;

      const candidates: number[] = [];
      nodes.forEach((node, index) => {
        if (remaining[index] <= 0) return;
        if (projects[node.projectIdx].deadline < date) return;
        if (usedDays[index].has(date)) return;
        const ready = node.deps.every((dep) => remaining[dep] <= 0 && (lastDate[dep] as string) < date);
        if (ready) candidates.push(index);
      });
      candidates.sort(priority);

      for (const index of candidates) {
        if (room <= 0) break;
        const projectIdx = nodes[index].projectIdx;
        const cap = projects[projectIdx].dailyCapMin;
        const projectRoom =
          cap === undefined || cap === null
            ? Number.POSITIVE_INFINITY
            : cap - (projectUsed.get(`${projectIdx}|${date}`) ?? 0);
        const amount = pickAmount(remaining[index], Math.min(room, projectRoom), params);
        if (amount <= 0) continue;
        place(index, date, amount);
        room -= amount;
      }
    }
  }

  const shortfall = projects.map(() => 0);
  nodes.forEach((node, index) => {
    shortfall[node.projectIdx] += Math.max(0, remaining[index]);
  });
  return { sessions, shortfall };
}

// ---------------------------------------------------------------------------
// Armado de la salida
// ---------------------------------------------------------------------------

type Summary = { plan: ProjectPlan; totalNeed: number };

function summarize(model: Model, core: CoreResult): Summary[] {
  const { projects, nodes, today, params } = model;
  return projects.map((project, projectIdx) => {
    const totalNeed = nodes.filter((n) => n.projectIdx === projectIdx).reduce((sum, n) => sum + n.need, 0);
    const own = core.sessions.filter((s) => nodes[s.nodeIndex].projectIdx === projectIdx);
    const plannedEndDate = own.length > 0 ? own.map((s) => s.date).sort().pop() ?? null : null;
    const shortfallMin = core.shortfall[projectIdx];
    const feasible = shortfallMin === 0;
    const target = targetDate(today, project.deadline, params.targetFraction);

    let bufferConsumedPct = 0;
    if (!feasible) {
      bufferConsumedPct = 100;
    } else if (plannedEndDate !== null && plannedEndDate > target) {
      const buffer = daysBetween(target, project.deadline);
      bufferConsumedPct =
        buffer <= 0 ? 100 : Math.min(100, Math.round((daysBetween(target, plannedEndDate) / buffer) * 100));
    }

    return {
      totalNeed,
      plan: {
        feasible,
        plannedEndDate,
        bufferDays: daysBetween(plannedEndDate ?? today, project.deadline),
        shortfallMin,
        bufferConsumedPct,
        targetDate: target
      }
    };
  });
}

function toSessions(model: Model, raw: RawSession[]): Session[] {
  const perNode = new Map<number, RawSession[]>();
  for (const session of raw) perNode.set(session.nodeIndex, [...(perNode.get(session.nodeIndex) ?? []), session]);

  const parts = new Map<RawSession, { part: number; total: number }>();
  for (const list of perNode.values()) {
    [...list]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .forEach((session, i, all) => parts.set(session, { part: i + 1, total: all.length }));
  }

  return [...raw]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return model.nodes[a.nodeIndex].order - model.nodes[b.nodeIndex].order;
    })
    .map((session) => {
      const node = model.nodes[session.nodeIndex];
      const info = parts.get(session) as { part: number; total: number };
      return {
        subtaskId: node.id,
        projectId: model.projects[node.projectIdx].id,
        date: session.date,
        minutes: session.minutes,
        part: info.part,
        totalParts: info.total
      };
    });
}

function buildWarnings(model: Model, summaries: Summary[]): SchedulerWarning[] {
  const warnings: SchedulerWarning[] = [];

  summaries.forEach((summary, index) => {
    const project = model.projects[index];
    if (summary.totalNeed === 0) return;
    if (!summary.plan.feasible) {
      warnings.push({
        code: "INFEASIBLE",
        projectId: project.id,
        message: `No entra antes del ${project.deadline}: faltan ${summary.plan.shortfallMin} min.`
      });
    } else if (summary.plan.bufferConsumedPct > TIGHT_THRESHOLD_PCT) {
      warnings.push({
        code: "TIGHT",
        projectId: project.id,
        message: `Entra justo: ya se usó ${summary.plan.bufferConsumedPct}% del margen.`
      });
    }
  });

  // Un día donde lo fijo ya pasa lo disponible: cualquier proyecto que lo use
  // tiene menos aire del que parece.
  const last = lastDayOf(model);
  if (last !== null) {
    for (let offset = 0; offset <= daysBetween(model.today, last); offset += 1) {
      const date = addDays(model.today, offset);
      const load = model.fixedLoad[date] ?? 0;
      if (load > 0 && load > capacityOn(date, model.availability, model.overrides)) {
        warnings.push({ code: "OVERLOADED_DAY", date, message: `El ${date} ya tiene más carga fija (${load} min) que tiempo disponible.` });
      }
    }
  }
  return warnings;
}

/** Corre el relleno con un input alterado y dice si el proyecto entra. */
function isFeasible(
  input: ScheduleInput,
  projectId: string,
  change: { extraPerDay?: number; deadlines?: Record<string, string> }
): boolean {
  const model = buildModel(input, change);
  const index = model.projects.findIndex((p) => p.id === projectId);
  return fill(model).shortfall[index] === 0;
}

/** Menor valor en [low, high] para el que `ok` es verdadero, o null. `ok` casi monótono. */
function smallestOk(low: number, high: number, ok: (value: number) => boolean): number | null {
  if (!ok(high)) return null;
  let lo = low;
  let hi = high;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  // La holgura estática hace que la búsqueda no sea estrictamente monótona: se
  // baja mientras el valor anterior también entre, para no devolver de más.
  while (lo > low && ok(lo - 1)) lo -= 1;
  return lo;
}

function computeOptions(input: ScheduleInput, project: SchedulerProject): InfeasibleOptions {
  const extraMinPerDay = smallestOk(1, MAX_EXTRA_PER_DAY, (extra) =>
    isFeasible(input, project.id, { extraPerDay: extra })
  );

  const extension = smallestOk(1, MAX_DEADLINE_EXTENSION_DAYS, (days) =>
    isFeasible(input, project.id, { deadlines: { [project.id]: addDays(project.deadline, days) } })
  );

  return {
    extraMinPerDay,
    achievableDeadline: extension === null ? null : addDays(project.deadline, extension)
  };
}

function assemble(input: ScheduleInput, model: Model, core: CoreResult): ScheduleOutput {
  const summaries = summarize(model, core);
  const perProject: Record<string, ProjectPlan> = {};
  summaries.forEach((summary, index) => {
    const project = model.projects[index];
    perProject[project.id] = summary.plan;
    // Sin trabajo pendiente no hay nada que no entre, aunque el deadline haya pasado.
    if (!summary.plan.feasible) perProject[project.id].options = computeOptions(input, project);
  });

  return {
    sessions: toSessions(model, core.sessions),
    perProject,
    warnings: buildWarnings(model, summaries)
  };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Decide cuándo trabajar en cada subtarea.
 *
 * Nunca inventa un plan imposible: lo que no entra antes del deadline queda
 * fuera de `sessions`, el proyecto sale con `feasible: false`, el faltante en
 * `shortfallMin` y las opciones para resolverlo en `options`.
 *
 * Lanza `SchedulerCycleError` si las dependencias de un proyecto forman un ciclo,
 * y `SchedulerError` ante ids repetidos, dependencias inexistentes o datos
 * inválidos.
 */
export function schedule(input: ScheduleInput): ScheduleOutput {
  validate(input);
  const model = buildModel(input);
  return assemble(input, model, fill(model));
}

export type PreviousPlan = {
  sessions: Session[];
  perProject?: Record<string, Pick<ProjectPlan, "feasible" | "bufferConsumedPct">>;
};

export type ReplanOutput = ScheduleOutput & {
  /** Proyectos que ahora no entran y en el plan anterior sí. */
  newlyInfeasible: string[];
  /** Proyectos que ahora pasan del 50% del margen y antes no. */
  newlyTight: string[];
  /** Sesiones de hoy en adelante que no estaban (o cambiaron) respecto del plan anterior. */
  changedSessions: number;
};

/**
 * De las sesiones del plan anterior, las que se pueden conservar tal cual.
 *
 * Una sesión sobrevive si es de hoy en adelante, su subtarea sigue sin hacer, el
 * día tiene lugar, se respeta el tope del proyecto y sus dependencias siguen
 * cumplidas por sesiones que también sobreviven. Todo lo demás se replanifica.
 */
function pinnableSessions(model: Model, previous: Session[]): RawSession[] {
  const { nodes, projects, today } = model;
  const indexById = new Map(nodes.map((n, i) => [n.id, i]));

  let candidates: RawSession[] = previous
    .filter((s) => s.date >= today && Number.isInteger(s.minutes) && s.minutes > 0)
    .map((s) => ({ nodeIndex: indexById.get(s.subtaskId) ?? -1, date: s.date, minutes: s.minutes, projectId: s.projectId }))
    .filter((s) => {
      if (s.nodeIndex < 0) return false;
      const node = nodes[s.nodeIndex];
      return node.need > 0 && projects[node.projectIdx].id === s.projectId && s.date <= projects[node.projectIdx].deadline;
    })
    .map(({ nodeIndex, date, minutes }) => ({ nodeIndex, date, minutes }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : nodes[a.nodeIndex].order - nodes[b.nodeIndex].order));

  for (let pass = 0; pass < nodes.length + 2; pass += 1) {
    // (1) Capacidad, tope del proyecto, una sesión por subtarea y día, y no
    // pasarse de lo que falta (lo último se recorta en vez de descartar).
    const usedCapacity = new Map<string, number>();
    const projectUsed = new Map<string, number>();
    const perNodeTotal = new Map<number, number>();
    const perNodeDays = new Set<string>();
    const kept: RawSession[] = [];

    for (const session of candidates) {
      const node = nodes[session.nodeIndex];
      const dayKey = `${session.nodeIndex}|${session.date}`;
      if (perNodeDays.has(dayKey)) continue;

      const stillNeeded = node.need - (perNodeTotal.get(session.nodeIndex) ?? 0);
      const minutes = Math.min(session.minutes, stillNeeded);
      if (minutes <= 0) continue;

      const room = capacity(model, session.date) - (usedCapacity.get(session.date) ?? 0);
      const cap = projects[node.projectIdx].dailyCapMin;
      const key = `${node.projectIdx}|${session.date}`;
      const projectRoom = cap === undefined || cap === null ? Infinity : cap - (projectUsed.get(key) ?? 0);
      if (minutes > room || minutes > projectRoom) continue;

      perNodeDays.add(dayKey);
      usedCapacity.set(session.date, (usedCapacity.get(session.date) ?? 0) + minutes);
      projectUsed.set(key, (projectUsed.get(key) ?? 0) + minutes);
      perNodeTotal.set(session.nodeIndex, (perNodeTotal.get(session.nodeIndex) ?? 0) + minutes);
      kept.push({ nodeIndex: session.nodeIndex, date: session.date, minutes });
    }

    // (2) Dependencias: un sucesor solo conserva sus sesiones si cada dependencia
    // sin hacer quedó cubierta por completo en días anteriores a la primera.
    const total = new Map<number, number>();
    const lastOf = new Map<number, string>();
    const firstOf = new Map<number, string>();
    for (const s of kept) {
      total.set(s.nodeIndex, (total.get(s.nodeIndex) ?? 0) + s.minutes);
      if (!lastOf.has(s.nodeIndex) || s.date > (lastOf.get(s.nodeIndex) as string)) lastOf.set(s.nodeIndex, s.date);
      if (!firstOf.has(s.nodeIndex) || s.date < (firstOf.get(s.nodeIndex) as string)) firstOf.set(s.nodeIndex, s.date);
    }
    const broken = new Set<number>();
    for (const nodeIndex of firstOf.keys()) {
      const ok = nodes[nodeIndex].deps.every(
        (dep) =>
          (total.get(dep) ?? 0) >= nodes[dep].need &&
          (lastOf.get(dep) as string) < (firstOf.get(nodeIndex) as string)
      );
      if (!ok) broken.add(nodeIndex);
    }

    const next = kept.filter((s) => !broken.has(s.nodeIndex));
    const stable = broken.size === 0 && next.length === candidates.length;
    candidates = next;
    if (stable) break;
  }

  return candidates;
}

/**
 * Vuelve a planificar con el estado actual, conservando lo que ya estaba
 * agendado de hoy en adelante mientras siga siendo válido.
 *
 * Es estable: con el mismo input y el plan que él mismo devolvió, devuelve
 * exactamente ese plan. Lo no hecho de días pasados vuelve a entrar desde hoy
 * porque las sesiones pasadas se descartan y lo que falta sale de la duración
 * efectiva menos `actualMin`; quien llama debe sumar a `actualMin` lo que el
 * usuario trabajó. Si conservar el plan deja a algún proyecto peor que uno
 * nuevo desde cero, gana el nuevo.
 */
export function replan(input: ScheduleInput, previous?: PreviousPlan): ReplanOutput {
  validate(input);
  const fresh = schedule(input);

  let result = fresh;
  let changedSessions = fresh.sessions.length;

  if (previous && previous.sessions.length > 0) {
    const model = buildModel(input);
    const pins = pinnableSessions(model, previous.sessions);
    if (pins.length > 0) {
      const pinned = assemble(input, model, fill(model, pins));
      const noWorse = Object.keys(fresh.perProject).every(
        (id) => pinned.perProject[id].shortfallMin <= fresh.perProject[id].shortfallMin
      );
      if (noWorse) result = pinned;
    }
    changedSessions = countChanged(result.sessions, previous.sessions, input.today);
  }

  const newlyInfeasible: string[] = [];
  const newlyTight: string[] = [];
  for (const [id, plan] of Object.entries(result.perProject)) {
    const before = previous?.perProject?.[id];
    if (!plan.feasible && (before?.feasible ?? true)) newlyInfeasible.push(id);
    if (plan.feasible && plan.bufferConsumedPct > TIGHT_THRESHOLD_PCT && (before?.bufferConsumedPct ?? 0) <= TIGHT_THRESHOLD_PCT) {
      newlyTight.push(id);
    }
  }

  return { ...result, newlyInfeasible, newlyTight, changedSessions };
}

function countChanged(next: Session[], previous: Session[], today: string): number {
  const key = (s: Session) => `${s.subtaskId}|${s.date}|${s.minutes}`;
  const before = new Set(previous.filter((s) => s.date >= today).map(key));
  return next.filter((s) => !before.has(key(s))).length;
}
