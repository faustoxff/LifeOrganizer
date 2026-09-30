import type { TaskChecklist } from "@/lib/checklist";
import type { Task } from "@/types/task";

/**
 * Cuándo avisar "no te olvides" antes de una actividad. Puro: el reloj entra por parámetro
 * (hora local del dispositivo, igual que el resto de los avisos de lib/use-reminders.ts).
 */

export const LEAD_OPTIONS_MIN = [10, 30, 60] as const;
export const DEFAULT_LEAD_MIN = 30;

export type ReminderPreference = "on" | "off" | null;

/**
 * ¿Está activo el aviso? Lo que el usuario eligió manda; sin elección, se activa solo si es
 * despistado, y si no se le ofrece (`shouldOffer`).
 */
export function reminderEnabled(preference: ReminderPreference, despistado: boolean): boolean {
  if (preference === "on") return true;
  if (preference === "off") return false;
  return despistado;
}

export function shouldOffer(preference: ReminderPreference, despistado: boolean): boolean {
  return preference === null && !despistado;
}

export function readLead(value: unknown): number {
  const n = Number(value);
  return (LEAD_OPTIONS_MIN as readonly number[]).includes(n) ? n : DEFAULT_LEAD_MIN;
}

/** Los ítems que el aviso lista: los que siguen en la lista y todavía no se tildaron. */
export function pendingItems(checklist: TaskChecklist | null | undefined): string[] {
  return (checklist?.items ?? []).filter((item) => !item.removed && !item.checked).map((item) => item.text);
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * Las tareas a avisar ahora: hoy, con hora, pendientes, con algo por llevar, dentro de los
 * `leadMin` minutos previos a la hora (y hasta la hora: pasada, ya no sirve), y que no se
 * hayan avisado. `today` es "YYYY-MM-DD" local y `nowMinutes` los minutos desde medianoche.
 */
export function dueChecklistReminders(input: {
  tasks: readonly Task[];
  today: string;
  nowMinutes: number;
  leadMin: number;
  fired: ReadonlySet<string>;
}): Task[] {
  return input.tasks.filter((task) => {
    if (task.done || task.status === "skipped" || task.dueDate !== input.today || !task.time) return false;
    if (input.fired.has(task.id) || pendingItems(task.checklist).length === 0) return false;
    const start = minutesOf(task.time);
    return input.nowMinutes >= start - input.leadMin && input.nowMinutes < start;
  });
}
