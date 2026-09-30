import { isDateKey } from "@/lib/recurrence";
import { addDays, daysBetween } from "@/lib/recurrence";
import { validateSubtaskList } from "@/lib/project-schema";
import { TOTAL_BUDGET } from "@/lib/context-summary";
import type { IntakeAnswer, PlannedSubtask } from "@/types/project";

/**
 * Validación de lo que el cliente manda al flujo de proyectos. Pura.
 *
 * Nada de lo que llega se confía: el plan y las fechas se recalculan siempre en el
 * servidor a partir de estas entradas.
 */

export const MAX_TITLE = 200;
/** Igual que el resto de las tareas: la descripción se guarda en tasks.description. */
export const MAX_DESCRIPTION = 2000;
export const MAX_HORIZON_DAYS = 730;
export const MAX_ACTIVE_PROJECTS = 15;
export const MAX_ANSWERS = 8;
export const MAX_ANSWER_CHARS = 600;

export type ParsedResult<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = <T>(error: string): ParsedResult<T> => ({ ok: false, error });

export type ProjectBasics = {
  title: string;
  description: string;
  deadline: string;
  contextSummary: string;
};

/** Título, descripción, fecha límite y resumen de archivos. La fecha no puede ser pasada ni lejanísima. */
export function parseProjectBasics(body: Record<string, unknown>, today: string): ParsedResult<ProjectBasics> {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 2 || title.length > MAX_TITLE) return fail("Invalid title");

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > MAX_DESCRIPTION) return fail("Invalid description");

  const deadline = body.deadline;
  if (!isDateKey(deadline)) return fail("Invalid deadline");
  if (deadline < today) return fail("The deadline is in the past");
  if (daysBetween(today, deadline) > MAX_HORIZON_DAYS) return fail("The deadline is too far away");

  const contextSummary = typeof body.contextSummary === "string" ? body.contextSummary.trim().slice(0, TOTAL_BUDGET) : "";
  return { ok: true, value: { title, description, deadline, contextSummary } };
}

export function parseAnswers(value: unknown): IntakeAnswer[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ANSWERS)
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
    .map((a, i) => ({
      id: typeof a.id === "string" ? a.id.slice(0, 30) : `q${i + 1}`,
      question: typeof a.question === "string" ? a.question.slice(0, 300) : "",
      answer: typeof a.answer === "string" ? a.answer.slice(0, MAX_ANSWER_CHARS) : ""
    }))
    .filter((a) => a.question.length > 0 && a.answer.trim().length > 0);
}

export function parseUnderstanding(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 1200) : "";
}

export function parseDailyCap(value: unknown): ParsedResult<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1440) return fail("Invalid daily cap");
  return { ok: true, value };
}

/** Un borrador para recalcular o confirmar: las subtareas que dejó el usuario. */
export type DraftBody = ProjectBasics & {
  dailyCapMin: number | null;
  subtasks: PlannedSubtask[];
  /** Minutos extra por día que el usuario eligió sumar a su disponibilidad (0 = ninguno). */
  extraMinPerDay: number;
};

export function parseDraftBody(body: Record<string, unknown>, today: string): ParsedResult<DraftBody> {
  const basics = parseProjectBasics(body, today);
  if (!basics.ok) return basics;

  const cap = parseDailyCap(body.dailyCapMin);
  if (!cap.ok) return cap;

  if (!Array.isArray(body.subtasks)) return fail("Invalid subtasks");
  // The user can trim scope down to a single subtask, so the floor is 1, not the AI's 4.
  const list = validateSubtaskList(body.subtasks, { min: 1, max: 25 });
  if (!list.ok) return fail(`Invalid subtasks: ${list.error}`);

  let extra = 0;
  if (body.extraMinPerDay !== undefined && body.extraMinPerDay !== null) {
    if (typeof body.extraMinPerDay !== "number" || !Number.isInteger(body.extraMinPerDay) || body.extraMinPerDay < 0 || body.extraMinPerDay > 1440) {
      return fail("Invalid extra minutes");
    }
    extra = body.extraMinPerDay;
  }

  return { ok: true, value: { ...basics.value, dailyCapMin: cap.value, subtasks: list.value, extraMinPerDay: extra } };
}

/** "Saltear" difiere la subtarea hasta mañana (en la zona del usuario). */
export function tomorrowOf(today: string): string {
  return addDays(today, 1);
}
