"use client";

import { useEffect, useState } from "react";
import { useAppLanguage } from "@/components/language-provider";
import { Select } from "@/components/ui/select";
import { DEFAULT_PREP, readPrep, type PrepSettings } from "@/lib/busy-blocks";
import { nowCopy } from "@/lib/now-copy";

const OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];

/**
 * El margen que Spark deja libre antes de un compromiso (viajar, prepararse), por tipo. Se guarda
 * al cambiarlo: no hay un botón aparte.
 */
export function PrepSettingsSection() {
  const { language } = useAppLanguage();
  const t = nowCopy(language).prep;
  const [prep, setPrep] = useState<PrepSettings>(DEFAULT_PREP);

  useEffect(() => {
    fetch("/api/settings/prep")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { calendarMin?: unknown; reminderMin?: unknown } | null) => {
        if (data) setPrep(readPrep(data.calendarMin, data.reminderMin));
      })
      .catch(() => {});
  }, []);

  function change(next: PrepSettings) {
    const previous = prep;
    setPrep(next);
    fetch("/api/settings/prep", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next)
    })
      .then((res) => {
        if (!res.ok) setPrep(previous);
      })
      .catch(() => setPrep(previous));
  }

  const options = (current: number) => (OPTIONS.includes(current) ? OPTIONS : [...OPTIONS, current].sort((a, b) => a - b));

  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="prep-title">
      <h3 id="prep-title" className="text-sm font-semibold">
        {t.title}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
      <div className="mt-3 grid grid-cols-[1fr_7rem] items-center gap-x-3 gap-y-2">
        <label htmlFor="prep-calendar" className="text-sm">
          {t.calendar}
        </label>
        <Select id="prep-calendar" value={prep.calendarMin} onChange={(e) => change({ ...prep, calendarMin: Number(e.target.value) })}>
          {options(prep.calendarMin).map((m) => (
            <option key={m} value={m}>
              {t.minutes(m)}
            </option>
          ))}
        </Select>
        <label htmlFor="prep-reminder" className="text-sm">
          {t.reminder}
        </label>
        <Select id="prep-reminder" value={prep.reminderMin} onChange={(e) => change({ ...prep, reminderMin: Number(e.target.value) })}>
          {options(prep.reminderMin).map((m) => (
            <option key={m} value={m}>
              {t.minutes(m)}
            </option>
          ))}
        </Select>
      </div>
    </section>
  );
}
