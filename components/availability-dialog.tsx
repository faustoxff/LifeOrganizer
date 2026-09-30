"use client";

import { useEffect, useRef, useState } from "react";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { DEFAULT_AVAILABILITY, type Availability } from "@/lib/availability";
import { weekdayLongName } from "@/lib/repeat-label";
import { formatMinutes } from "@/lib/task-estimate";

/** De lunes a domingo: es como se lee una semana de trabajo. Las claves siguen siendo 0 = domingo. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const STEP_MIN = 15;
const DEFAULT_SLIDER_MAX = 480;

type Props = {
  /** onboarding: primera vez, sin cierre. settings: se abre desde el encabezado. */
  mode: "onboarding" | "settings";
  initial: Availability;
  onSave: (availability: Availability) => Promise<boolean>;
  onClose: () => void;
};

/**
 * Cuánto tiempo por día puede dedicar el usuario a sus pendientes. El scheduler
 * solo planifica trabajo dentro de estas horas.
 */
export function AvailabilityDialog({ mode, initial, onSave, onClose }: Props) {
  const { copy, language } = useAppLanguage();
  const [values, setValues] = useState<Availability>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const firstSlider = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstSlider.current?.focus();
    if (mode !== "settings") return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  async function save(next: Availability) {
    setIsSaving(true);
    try {
      if (await onSave(next)) onClose();
    } finally {
      setIsSaving(false);
    }
  }

  const title = mode === "onboarding" ? copy.availability.question : copy.availability.title;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="availability-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-lg"
      >
        <h2 id="availability-title" className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.availability.hint}</p>

        <ul className="mt-5 flex flex-col gap-3">
          {DISPLAY_ORDER.map((day, index) => {
            const key = String(day) as keyof Availability;
            const minutes = values[key];
            const label = weekdayLongName(day, language);
            return (
              <li key={day} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-3">
                <label htmlFor={`availability-${day}`} className="truncate text-sm capitalize">
                  {label}
                </label>
                <input
                  ref={index === 0 ? firstSlider : undefined}
                  id={`availability-${day}`}
                  type="range"
                  min={0}
                  max={Math.max(DEFAULT_SLIDER_MAX, minutes)}
                  step={STEP_MIN}
                  value={minutes}
                  disabled={isSaving}
                  onChange={(e) => setValues((current) => ({ ...current, [key]: Number(e.target.value) }))}
                  className="h-2 w-full cursor-pointer accent-primary"
                />
                <span className="text-right text-sm tabular-nums text-muted-foreground">
                  {minutes === 0 ? copy.availability.off : formatMinutes(minutes)}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="button" disabled={isSaving} onClick={() => void save(values)}>
            {copy.availability.save}
          </Button>
          {mode === "onboarding" ? (
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => void save({ ...DEFAULT_AVAILABILITY })}>
              {copy.availability.useDefaults}
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled={isSaving} onClick={onClose}>
              {copy.common.cancel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
