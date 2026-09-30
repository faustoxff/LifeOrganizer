import { describe, expect, it } from "vitest";
import { copy, supportedLanguages } from "@/lib/i18n";

/** Todas las rutas hoja de un objeto: "taskForm.kinds.reminder", ... */
function paths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key)
  );
}

function get(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], value);
}

describe("i18n", () => {
  const reference = paths(copy.en).sort();

  it("todos los idiomas tienen exactamente las mismas claves que el inglés", () => {
    for (const language of supportedLanguages) {
      const keys = paths(copy[language]).sort();
      const missing = reference.filter((key) => !keys.includes(key));
      const extra = keys.filter((key) => !reference.includes(key));
      expect({ language, missing, extra }).toEqual({ language, missing: [], extra: [] });
    }
  });

  const NEW_STRINGS = [
    "taskForm.kind", "taskForm.kinds.reminder", "taskForm.kinds.task", "taskForm.kinds.project",
    "taskForm.time", "taskForm.timeOptional", "taskForm.timeRequired",
    "taskForm.repeat", "taskForm.repeatOptions.none", "taskForm.repeatOptions.daily",
    "taskForm.repeatOptions.weekdays", "taskForm.repeatOptions.everyNWeeks",
    "taskForm.repeatOptions.monthly", "taskForm.repeatEvery", "taskForm.repeatWeeks",
    "taskForm.repeatOnDays", "taskForm.repeatDays", "taskForm.repeatMonths", "scope.editTitle", "scope.deleteTitle", "scope.editQuestion",
    "scope.deleteQuestion", "scope.thisOnly", "scope.thisAndFollowing",
    "calendar.todayReminders", "taskList.repeats",
    "availability.title", "availability.question", "availability.hint", "availability.save",
    "availability.useDefaults", "availability.open", "availability.off"
  ];

  it("el texto nuevo existe y no está vacío en los 13 idiomas", () => {
    expect(supportedLanguages).toHaveLength(13);
    for (const language of supportedLanguages) {
      for (const path of NEW_STRINGS) {
        const text = get(copy[language], path);
        expect(typeof text, `${language}:${path}`).toBe("string");
        expect((text as string).trim().length, `${language}:${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("los tres tipos se distinguen entre sí en cada idioma", () => {
    for (const language of supportedLanguages) {
      const kinds = Object.values(copy[language].taskForm.kinds);
      expect(new Set(kinds).size, language).toBe(3);
    }
  });

  it("el inglés y el español no reutilizan una traducción a medias", () => {
    expect(copy.en.taskForm.kinds.reminder).toBe("Reminder");
    expect(copy.es.taskForm.kinds.reminder).toBe("Recordatorio");
    expect(copy.es.scope.thisAndFollowing).toBe("Esta y las siguientes");
  });
});
