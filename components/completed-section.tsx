"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { monthCopy } from "@/lib/focus-copy";
import { cn } from "@/lib/utils";
import type { TaskKind } from "@/types/task";

export type CompletedItem = { id: string; title: string; category: string; kind: TaskKind; completedAt: string };

/** First day of the current month, "YYYY-MM-DD", in local time. */
function monthStartKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Everything the user finished: this month first, older ones one click away. The list moved here from the main
// screen so "Today" only shows what is still open. Reopening puts the task back in the pending list.
export function CompletedSection({ items, onReopen }: { items: CompletedItem[]; onReopen: (id: string) => void }) {
  const { copy, language } = useAppLanguage();
  const monthT = monthCopy[language];
  const [open, setOpen] = useState(true);
  const [showOlder, setShowOlder] = useState(false);

  if (items.length === 0) return null;

  // `completedAt` is an ISO timestamp (or a due date for old rows): the first 10 characters are the day.
  const start = monthStartKey();
  const thisMonth = items.filter((item) => item.completedAt.slice(0, 10) >= start);
  const older = items.filter((item) => item.completedAt.slice(0, 10) < start);
  const visible = showOlder ? items : thisMonth;
  const formatDay = (value: string) =>
    new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(new Date(value));

  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-testid="completed-section">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        {monthT.thisMonth} ({thisMonth.length})
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {visible.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-muted-foreground line-through">{item.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span>{copy.taskForm.kinds[item.kind]}</span>
                    <span>·</span>
                    <span>{item.category}</span>
                    <span>·</span>
                    <span>{formatDay(item.completedAt)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onReopen(item.id)}
                  className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-primary"
                  aria-label={copy.taskList.markPending}
                  title={copy.taskList.markPending}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          {older.length > 0 && !showOlder && (
            <button
              type="button"
              onClick={() => setShowOlder(true)}
              className="mt-3 text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              {monthT.showOlder} ({older.length})
            </button>
          )}
        </>
      )}
    </section>
  );
}
