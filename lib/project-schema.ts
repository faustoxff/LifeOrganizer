import { findBalancedJson, stripCodeFence } from "@/lib/task-actions";
import { findDependencyCycle } from "@/lib/scheduler";
import type { Intake, IntakeQuestion, PlannedSubtask, QuestionType } from "@/types/project";

/**
 * Validación de lo que devuelve la IA en el flujo de proyectos.
 *
 * Todo es puro y devuelve un mensaje específico cuando algo está mal: ese mensaje
 * es lo que se le manda al modelo en el reintento ("tu respuesta falló por esto"),
 * así que tiene que decir qué arreglar, no solo que algo falló.
 */

export const MAX_QUESTIONS = 5;
export const MIN_SUBTASKS = 4;
export const MAX_SUBTASKS = 25;
export const MIN_SUBTASK_MIN = 10;
export const MAX_SUBTASK_MIN = 240;
/** Una subtarea para "arrancar hoy" tiene que caber en esto. */
export const FIRST_SUBTASK_MAX_MIN = 30;

const MAX_TITLE = 120;
const MAX_QUESTION_TEXT = 300;
const MAX_OPTION = 80;

export type ParseResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; error: string };

/** Saca el primer objeto JSON de la respuesta, aunque venga con texto o cercas de código. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const unfenced = stripCodeFence(text.trim());
  const balanced = findBalancedJson(unfenced.slice(Math.max(0, unfenced.indexOf("{"))));
  if (!balanced || !balanced.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(balanced) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.trim().length >= min && value.trim().length <= max;

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

export function parseIntake(raw: string): ParseResult<Intake> {
  const json = extractJsonObject(raw);
  if (!json) return { ok: false, error: "The reply is not a valid JSON object." };

  const understanding = typeof json.understanding === "string" ? json.understanding.trim() : "";
  if (understanding.length < 10) {
    return { ok: false, error: '"understanding" must be a string of 2-4 lines describing what you understood.' };
  }
  if (!Array.isArray(json.questions)) {
    return { ok: false, error: '"questions" must be an array (use [] when nothing needs asking).' };
  }

  const warnings: string[] = [];
  const questions: IntakeQuestion[] = [];
  const usedIds = new Set<string>();

  for (const [index, item] of json.questions.entries()) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: `questions[${index}] must be an object.` };
    }
    const q = item as Record<string, unknown>;
    if (!isText(q.text, 3, MAX_QUESTION_TEXT)) {
      return { ok: false, error: `questions[${index}].text must be a non-empty string of at most ${MAX_QUESTION_TEXT} characters.` };
    }

    // An id is bookkeeping, not content: a missing or repeated one is repaired
    // instead of costing the whole reply.
    let id = typeof q.id === "string" ? q.id.trim().slice(0, 30) : "";
    if (!id || usedIds.has(id)) id = `q${index + 1}`;
    while (usedIds.has(id)) id = `${id}_`;
    usedIds.add(id);

    let type: QuestionType = q.type === "choice" || q.type === "number" ? q.type : "text";
    let options: string[] | undefined;
    if (type === "choice") {
      const list = Array.isArray(q.options)
        ? [...new Set(q.options.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter((o) => o.length > 0 && o.length <= MAX_OPTION))]
        : [];
      if (list.length >= 2) options = list.slice(0, 6);
      else {
        // A choice with nothing to choose from is a free-text question.
        type = "text";
        warnings.push(`questions[${index}] was a choice without usable options; kept as text.`);
      }
    }

    questions.push({
      id,
      text: (q.text as string).trim(),
      why: typeof q.why === "string" ? q.why.trim().slice(0, 300) : "",
      type,
      ...(options ? { options } : {})
    });
  }

  if (questions.length > MAX_QUESTIONS) {
    warnings.push(`Received ${questions.length} questions; kept the first ${MAX_QUESTIONS}.`);
  }

  return {
    ok: true,
    value: { understanding, questions: questions.slice(0, MAX_QUESTIONS) },
    warnings
  };
}

// ---------------------------------------------------------------------------
// Plan (subtasks)
// ---------------------------------------------------------------------------

/**
 * Valida las subtareas que propone la IA: JSON, cantidad, títulos, estimaciones de
 * 10 a 240 min, ids únicos, dependencias que existan y un DAG sin ciclos. Junta todos
 * los problemas (no solo el primero) para que el reintento los arregle de una vez.
 */
export function parsePlan(raw: string): ParseResult<PlannedSubtask[]> {
  const json = extractJsonObject(raw);
  if (!json) return { ok: false, error: "The reply is not a valid JSON object." };
  if (!Array.isArray(json.subtasks)) {
    return { ok: false, error: '"subtasks" must be an array.' };
  }

  const problems: string[] = [];
  const list = json.subtasks;

  if (list.length < MIN_SUBTASKS || list.length > MAX_SUBTASKS) {
    problems.push(`Expected between ${MIN_SUBTASKS} and ${MAX_SUBTASKS} subtasks, got ${list.length}.`);
  }

  const subtasks: PlannedSubtask[] = [];
  const ids = new Set<string>();

  list.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      problems.push(`subtasks[${index}] must be an object.`);
      return;
    }
    const s = item as Record<string, unknown>;
    const label = typeof s.tempId === "string" && s.tempId ? s.tempId : `subtasks[${index}]`;

    if (!isText(s.tempId, 1, 40)) problems.push(`${label}: tempId must be a non-empty string.`);
    else if (ids.has(s.tempId.trim())) problems.push(`${label}: duplicate tempId.`);
    else ids.add(s.tempId.trim());

    if (!isText(s.title, 3, MAX_TITLE)) problems.push(`${label}: title must be 3-${MAX_TITLE} characters.`);

    if (typeof s.estimateMin !== "number" || !Number.isInteger(s.estimateMin)) {
      problems.push(`${label}: estimateMin must be an integer number of minutes.`);
    } else if (s.estimateMin < MIN_SUBTASK_MIN || s.estimateMin > MAX_SUBTASK_MIN) {
      problems.push(`${label}: estimateMin ${s.estimateMin} is out of range (${MIN_SUBTASK_MIN}-${MAX_SUBTASK_MIN}); split it or merge it.`);
    }

    if (s.dependsOn !== undefined && !Array.isArray(s.dependsOn)) {
      problems.push(`${label}: dependsOn must be an array of tempIds.`);
    }

    subtasks.push({
      tempId: typeof s.tempId === "string" ? s.tempId.trim() : "",
      title: typeof s.title === "string" ? s.title.trim() : "",
      estimateMin: typeof s.estimateMin === "number" ? s.estimateMin : 0,
      dependsOn: Array.isArray(s.dependsOn)
        ? [...new Set(s.dependsOn.filter((d): d is string => typeof d === "string").map((d) => d.trim()))]
        : [],
      deliverable: s.deliverable === true
    });
  });

  for (const subtask of subtasks) {
    for (const dep of subtask.dependsOn) {
      if (dep === subtask.tempId) problems.push(`${subtask.tempId}: depends on itself.`);
      else if (!ids.has(dep)) problems.push(`${subtask.tempId}: depends on unknown tempId "${dep}".`);
    }
  }

  // Only worth looking for a cycle once every id resolves.
  if (problems.length === 0) {
    const cycle = findDependencyCycle(subtasks.map((s) => ({ id: s.tempId, dependsOn: s.dependsOn })));
    if (cycle) problems.push(`Circular dependency: ${cycle.join(" -> ")}. Dependencies must form a DAG.`);
  }

  if (problems.length > 0) {
    return { ok: false, error: problems.slice(0, 12).join(" ") };
  }

  const warnings: string[] = [];
  const canStartToday = subtasks.some((s) => s.dependsOn.length === 0 && s.estimateMin <= FIRST_SUBTASK_MAX_MIN);
  if (!canStartToday) {
    warnings.push(`No subtask can be started today in ${FIRST_SUBTASK_MAX_MIN} minutes or less.`);
  }
  return { ok: true, value: subtasks, warnings };
}

/** Un identificador de subtarea seguro para guardar y devolver. */
export function sanitizeTempIds(subtasks: PlannedSubtask[]): PlannedSubtask[] {
  return subtasks.map((s) => ({ ...s, tempId: s.tempId.slice(0, 40) }));
}
