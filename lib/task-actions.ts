import { isDateKey, normalizeRepeat } from "@/lib/recurrence";
import { DEFAULT_ESTIMATE_BY_KIND, isValidEstimate } from "@/lib/task-estimate";
import { suggestKind } from "@/lib/task-kind";
import type { TaskInput, TaskKind, TaskPriority } from "@/types/task";

/**
 * Milo's task block used to be parsed with `JSON.parse` over everything that
 * followed the `TASKS_ACTION:` marker. That throws away the whole batch — with
 * no error and nothing in the logs — whenever the model adds a period, wraps the
 * JSON in a ``` fence, keeps talking after the block, or gets cut off by
 * `max_tokens`. Recurring requests ("gimnasio los miércoles y sábados") used to
 * expand to one task per occurrence, so those are the ones that reliably
 * overflowed and silently created nothing. A recurrence is now ONE item with a
 * `repeat`, and the server creates the series; the expansion problem is gone,
 * but the parser stays defensive because the other failure modes are not.
 *
 * Everything here is pure so the mangling cases can be pinned by tests.
 */

export const MAX_TASK_ACTIONS = 12;

const MARKER = /TASKS_ACTION\s*:/i;

export type ParsedTaskActions = {
  /** The reply with the machine block removed. */
  text: string;
  taskActions: TaskInput[];
  /** Set when a block was present but unusable, so the route can log why. */
  error: string | null;
  /** True when the JSON was cut short and we recovered only part of it. */
  partial: boolean;
};

function defaultDueDate(now: Date): string {
  const sevenDaysLater = new Date(now);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  return sevenDaysLater.toISOString().split("T")[0];
}

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const KINDS: TaskKind[] = ["reminder", "task", "project"];

export function normalizeTaskAction(
  parsed: unknown,
  now: Date = new Date()
): TaskInput | null {
  if (!parsed || typeof parsed !== "object") return null;
  const item = parsed as Partial<Record<keyof TaskInput, unknown>>;

  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (!title) return null;

  const priority: TaskPriority = ["low", "medium", "high"].includes(item.priority as TaskPriority)
    ? (item.priority as TaskPriority)
    : "medium";

  // A malformed date is worse than no date: it would sort the task randomly
  // instead of falling back to the documented default.
  const dueDate =
    typeof item.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
      ? item.dueDate
      : defaultDueDate(now);

  const time = typeof item.time === "string" && TIME_RE.test(item.time) ? item.time : undefined;
  const description = typeof item.description === "string" ? item.description.trim() : "";

  // `kind` is optional for the model. When it is missing or nonsense the same
  // rules the form uses pick one, so a reminder created by chat and one created
  // by hand end up the same.
  const kind: TaskKind = KINDS.includes(item.kind as TaskKind)
    ? (item.kind as TaskKind)
    : suggestKind({ title, description, dueDate, time, today: now.toISOString().split("T")[0] });

  const action: TaskInput = {
    title,
    category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : "general",
    description,
    priority,
    estimateMin: isValidEstimate(item.estimateMin) ? item.estimateMin : DEFAULT_ESTIMATE_BY_KIND[kind],
    dueDate,
    kind
  };
  if (time) action.time = time;

  // A broken `repeat` costs the recurrence, never the item: the user still gets
  // the task they asked for, once. Projects do not repeat.
  const repeat = kind === "project" ? null : normalizeRepeat(item.repeat);
  if (repeat) {
    // An end before the first date would produce a series with nothing in it.
    if (repeat.until && (!isDateKey(repeat.until) || repeat.until < dueDate)) delete repeat.until;
    action.repeat = repeat;
  }

  return action;
}

/**
 * Finds the first balanced `[...]` or `{...}` run in `text`, ignoring brackets
 * that live inside JSON strings. Returns null when nothing balances.
 */
export function findBalancedJson(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "[" ? "]" : "}";

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (isEscaped) { isEscaped = false; continue; }
      if (char === "\\") { isEscaped = true; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "[" || char === "{") { depth += 1; continue; }
    if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return char === close ? text.slice(start, i + 1) : null;
    }
  }
  return null; // never closed — truncated
}

export function stripCodeFence(text: string): string {
  return text
    .replace(/^\s*```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
}

/**
 * Recovers every complete `{...}` object from a truncated array, so a reply that
 * hit `max_tokens` still yields the tasks that made it through.
 */
export function salvageObjects(text: string): unknown[] {
  const found: unknown[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "{") { i += 1; continue; }

    let depth = 0;
    let inString = false;
    let isEscaped = false;
    let closed = -1;

    for (let j = i; j < text.length; j += 1) {
      const char = text[j];
      if (inString) {
        if (isEscaped) { isEscaped = false; continue; }
        if (char === "\\") { isEscaped = true; continue; }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) { closed = j; break; }
      }
    }

    if (closed === -1) break; // trailing object was cut off
    try {
      found.push(JSON.parse(text.slice(i, closed + 1)));
    } catch {
      // keep going: a single bad object should not lose the rest
    }
    i = closed + 1;
  }

  return found;
}

/** Every balanced `[...]` / `{...}` run in `text`, as non-overlapping spans. */
function findJsonSpans(text: string): Array<{ start: number; end: number; content: string }> {
  const spans: Array<{ start: number; end: number; content: string }> = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "{" && text[i] !== "[") {
      i += 1;
      continue;
    }

    const start = i;
    const open = text[i];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    let end = -1;

    for (let j = i; j < text.length; j += 1) {
      const char = text[j];
      if (inString) {
        if (isEscaped) { isEscaped = false; continue; }
        if (char === "\\") { isEscaped = true; continue; }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{" || char === "[") { depth += 1; continue; }
      if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) { end = j + 1; break; }
        if (char !== close) break; // mismatched bracket: not JSON, resume scanning
      }
    }

    if (end === -1) { i += 1; continue; }
    spans.push({ start, end, content: text.slice(start, end) });
    i = end;
  }

  return spans;
}

/**
 * Removes a task array the model duplicated into the prose. Groq's pro model
 * sometimes writes the JSON once as part of the sentence and again after the
 * marker, which used to leave `{"title":"..."` sitting in the chat bubble.
 *
 * Scoped to spans that actually carry a `title` field, so a reply that
 * legitimately talks about JSON is not mangled.
 */
export function stripLeakedTaskJson(text: string): string {
  const taskSpans = findJsonSpans(text).filter((s) => /"title"\s*:/.test(s.content));
  if (taskSpans.length === 0) return text;

  let result = "";
  let cursor = 0;
  for (const span of taskSpans) {
    result += text.slice(cursor, span.start);
    cursor = span.end;
  }
  result += text.slice(cursor);

  return result
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strips a leaked machine block from user-visible text. */
export function stripTaskBlock(text: string): string {
  const match = text.match(MARKER);
  const visible =
    match && match.index !== undefined
      ? (() => {
          const before = text.slice(0, match.index);
          const after = text.slice(match.index + match[0].length);
          const tail = findBalancedJson(after);

          if (tail === null) {
            // The block never closed, so `after` is a half-written array, not
            // prose. Keeping it is how raw `{"title":"L` ended up rendered in the
            // chat bubble after a long daily recurrence hit the token ceiling.
            // Only plain prose with no JSON punctuation is worth keeping.
            const isProse = !/[[{]/.test(after);
            const leftover = isProse ? after.trim() : "";
            if (!leftover) return before.trim();
            if (!before.trim()) return leftover;
            return `${before.trimEnd()}\n${leftover}`.replace(/\n{3,}/g, "\n\n").trim();
          }

          // Anything the model wrote after a closed block is prose.
          const leftover = after.slice(after.indexOf(tail) + tail.length).trim();
          if (!leftover) return before.trim();
          if (!before.trim()) return leftover;
          return `${before.trimEnd()}\n${leftover}`.replace(/\n{3,}/g, "\n\n").trim();
        })()
      : text.trim();

  return stripLeakedTaskJson(visible);
}

export function parseTaskActions(response: string, now: Date = new Date()): ParsedTaskActions {
  const match = response.match(MARKER);
  if (!match || match.index === undefined) {
    return { text: response.trim(), taskActions: [], error: null, partial: false };
  }

  const text = stripTaskBlock(response);
  const raw = stripCodeFence(response.slice(match.index + match[0].length));

  const balanced = findBalancedJson(raw);
  if (balanced) {
    try {
      const parsed = JSON.parse(balanced) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const taskActions = items
        .map((item) => normalizeTaskAction(item, now))
        .filter((t): t is TaskInput => t !== null)
        .slice(0, MAX_TASK_ACTIONS);
      if (taskActions.length > 0) {
        return { text, taskActions, error: null, partial: false };
      }
      return { text, taskActions: [], error: "todos los objetos vinieron sin title", partial: false };
    } catch (error) {
      const salvaged = salvageObjects(balanced)
        .map((item) => normalizeTaskAction(item, now))
        .filter((t): t is TaskInput => t !== null)
        .slice(0, MAX_TASK_ACTIONS);
      if (salvaged.length > 0) {
        return { text, taskActions: salvaged, error: null, partial: true };
      }
      return {
        text,
        taskActions: [],
        error: `JSON invalido: ${error instanceof Error ? error.message : "desconocido"}`,
        partial: false
      };
    }
  }

  // Nothing balanced: the model either wrote prose or got cut off mid-object.
  const salvaged = salvageObjects(raw)
    .map((item) => normalizeTaskAction(item, now))
    .filter((t): t is TaskInput => t !== null)
    .slice(0, MAX_TASK_ACTIONS);

  if (salvaged.length > 0) {
    return { text, taskActions: salvaged, error: null, partial: true };
  }
  return { text, taskActions: [], error: "no se encontro un bloque JSON balanceado", partial: false };
}
