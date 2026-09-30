"use client";

import { useEffect, useState } from "react";
import { Bell, CheckSquare, ChevronDown, Loader2, Plus, RotateCcw, Square, X } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { LEAD_OPTIONS_MIN } from "@/lib/checklist-reminder";
import type { ChecklistsApi } from "@/lib/use-checklists";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";

type Props = {
  task: Task;
  api: ChecklistsApi;
  /** El permiso de notificaciones del navegador y cómo pedirlo. */
  notifications: { granted: boolean; canAsk: boolean; enable: () => void };
};

/**
 * La checklist de "no te olvides" de una tarea u ocurrencia. Aparece solo si Spark reconoce
 * una actividad (gimnasio, viaje…). Cerrada es un chip; abierta se arma la primera vez.
 */
export function TaskChecklist({ task, api, notifications }: Props) {
  const { copy } = useAppLanguage();
  const t = copy.checklist;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const activity = api.activityOf(task.id);
  const checklist = api.checklistOf(task.id) ?? task.checklist ?? null;

  useEffect(() => {
    if (open && activity && !checklist && !api.isLoading(task.id)) void api.load(task.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activity]);

  if (!api.enabled || !activity || task.done) return null;

  const items = (checklist?.items ?? []).filter((i) => !i.removed);
  const removed = (checklist?.items ?? []).filter((i) => i.removed);
  const total = items.length;
  const checked = items.filter((i) => i.checked).length;
  const degraded = api.degradedOf(task.id);
  const loading = api.isLoading(task.id);

  async function run(change: Parameters<ChecklistsApi["edit"]>[1]) {
    setBusy(true);
    await api.edit(task.id, change);
    setBusy(false);
  }

  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await run({ op: "add", text });
  }

  return (
    <div className="mt-1.5" data-testid="task-checklist">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15"
      >
        <CheckSquare className="h-3 w-3" aria-hidden />
        {checklist ? t.chip(checked, total) : t.title}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-border bg-card/60 p-3">
          {loading && !checklist ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {t.loading}
            </p>
          ) : (
            <>
              {checklist?.weather && (
                <p className="text-[11px] font-medium text-muted-foreground">{t.weather[checklist.weather]}</p>
              )}

              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.empty}</p>
              ) : (
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.text} className="flex items-center gap-2 text-sm">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run({ op: "toggle", text: item.text })}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                        aria-pressed={item.checked}
                      >
                        {item.checked ? <CheckSquare className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden /> : <Square className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />}
                        <span className={cn("truncate", item.checked && "text-muted-foreground line-through")}>{item.text}</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run({ op: "remove", text: item.text })}
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-60"
                        aria-label={`${t.removeItem}: ${item.text}`}
                        title={t.removeItem}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {degraded && (
                <p className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400" role="status">
                  {degraded === "limit" ? t.degradedLimit : t.degradedFailed}
                  {degraded === "ai_failed" && (
                    <button type="button" onClick={() => void api.load(task.id, true)} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                      <RotateCcw className="h-3 w-3" aria-hidden /> {t.retry}
                    </button>
                  )}
                </p>
              )}

              {removed.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {removed.map((item) => (
                    <li key={item.text}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run({ op: "restore", text: item.text })}
                        className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground line-through hover:text-foreground"
                        aria-label={`${t.restoreItem}: ${item.text}`}
                        title={t.restoreItem}
                      >
                        {item.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t.addPlaceholder}
                  maxLength={60}
                  aria-label={t.addPlaceholder}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                />
                <button type="submit" disabled={busy || !draft.trim()} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">
                  <Plus className="h-3 w-3" aria-hidden /> {t.add}
                </button>
              </form>

              <ReminderRow api={api} notifications={notifications} />

              <button type="button" onClick={() => void api.dismiss(task.id)} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                {t.notActivity}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReminderRow({ api, notifications }: { api: ChecklistsApi; notifications: Props["notifications"] }) {
  const { copy } = useAppLanguage();
  const t = copy.checklist;

  if (api.offerReminder) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary/50 px-2 py-1.5 text-xs" data-testid="reminder-offer">
        <Bell className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">{t.offer}</span>
        <button type="button" onClick={() => api.setPreference("on")} className="font-semibold text-primary">
          {t.offerYes}
        </button>
        <button type="button" onClick={() => api.setPreference("off")} className="text-muted-foreground">
          {t.offerNo}
        </button>
      </div>
    );
  }

  if (!api.reminderActive) {
    return (
      <button type="button" onClick={() => api.setPreference("on")} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2">
        <Bell className="h-3 w-3" aria-hidden /> {t.remindOn(api.leadMin)}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="reminder-on">
      <Bell className="h-3.5 w-3.5 text-primary" aria-hidden />
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{t.leadLabel}</span>
        <select
          value={api.leadMin}
          onChange={(event) => api.setLeadMin(Number(event.target.value))}
          className="rounded border border-border bg-background px-1 py-0.5"
          aria-label={t.leadLabel}
        >
          {LEAD_OPTIONS_MIN.map((min) => (
            <option key={min} value={min}>
              {t.lead(min)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => api.setPreference("off")} className="text-muted-foreground underline underline-offset-2">
        {t.remindOff}
      </button>
      {!notifications.granted && notifications.canAsk && (
        <button type="button" onClick={notifications.enable} className="font-semibold text-primary underline underline-offset-2">
          {t.enableNotifications}
        </button>
      )}
    </div>
  );
}
