"use client";

import { useAppLanguage } from "@/components/language-provider";
import { patternsCopy } from "@/lib/patterns-copy";
import { adjustedEstimate, DAY_PARTS, type UserPatterns } from "@/lib/user-patterns";

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * "Cómo trabajás": lo que Spark aprendió de los últimos 90 días del usuario. Cada número sale
 * de `lib/user-patterns.ts`; lo que todavía no se aprendió dice cuántas tareas faltan.
 */
export function WorkPatterns({ patterns }: { patterns: UserPatterns }) {
  const { language } = useAppLanguage();
  const t = patternsCopy(language).section;
  const { inflation, hours, postponers } = patterns;

  // Solo las categorías con medición propia: las que caen al promedio no son un dato de ellas.
  const measured = Object.entries(inflation.categories).filter(([, entry]) => entry.source === "category");
  const chronic = [
    ...postponers.tasks.slice(0, 3).map((task) => t.postponedTask(task.title, task.count)),
    ...postponers.categories.slice(0, 2).map((c) => t.postponedCategory(capitalize(c.category), c.count))
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-4" aria-labelledby="work-patterns-title" data-testid="work-patterns">
      <h2 id="work-patterns-title" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t.title}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t.subtitle}</p>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">{t.timeTitle}</h3>
          {!inflation.global.learned ? (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="time-learning">
              {t.timeLearning(patterns.measuredNeeded)}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>{t.timeRow(t.timeGeneral, 30, adjustedEstimate(30, inflation.global.factor), inflation.global.samples)}</li>
              {measured.map(([category, entry]) => (
                <li key={category}>{t.timeRow(capitalize(category), 30, adjustedEstimate(30, entry.factor), entry.samples)}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold">{t.hoursTitle}</h3>
          {!hours.learned ? (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="hours-learning">
              {t.hoursLearning(hours.needed)}
            </p>
          ) : (
            <div className="mt-2">
              <p className="text-sm">{hours.best ? t.hoursBest(t.parts[hours.best]) : t.hoursNoBest}</p>
              <ul className="mt-2 space-y-1.5">
                {DAY_PARTS.map((part) => (
                  <li key={part} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-24 flex-shrink-0">{capitalize(t.parts[part])}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary/15">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${hours.shares[part]}%` }} />
                    </span>
                    <span className="w-9 text-right tabular-nums">{hours.shares[part]}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {chronic.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">{t.postponeTitle}</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {chronic.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
