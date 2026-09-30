import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { supportedLanguages } from "@/lib/i18n";
import { patternsCopy } from "@/lib/patterns-copy";
import { DAY_PARTS } from "@/lib/user-patterns";

describe("texto de los patrones (es/en)", () => {
  it("español: la pista al estimar y la sección", () => {
    const t = patternsCopy("es");
    expect(t.hintCategory(30, "Estudio", 45)).toBe("Estimaste 30 min; en Estudio solés tardar ~45.");
    expect(t.hintGeneral(30, 45)).toBe("Estimaste 30 min; solés tardar ~45.");
    expect(t.section.title).toBe("Cómo trabajás");
    expect(t.section.timeLearning(1)).toMatch(/Falta 1 tarea/);
    expect(t.section.timeLearning(3)).toMatch(/Faltan 3 tareas/);
    expect(t.section.hoursLearning(15)).toMatch(/Faltan 15 tareas completadas/);
  });

  it("inglés: la pista al estimar y la sección", () => {
    const t = patternsCopy("en");
    expect(t.hintCategory(30, "Study", 45)).toBe("You estimated 30 min; in Study you usually take ~45.");
    expect(t.section.timeLearning(1)).toMatch(/1 more task /);
    expect(t.section.timeLearning(4)).toMatch(/4 more tasks/);
  });

  it("todas las franjas tienen nombre no vacío en es y en", () => {
    for (const language of ["es", "en"] as const) {
      for (const part of DAY_PARTS) expect(patternsCopy(language).section.parts[part].length).toBeGreaterThan(0);
    }
  });

  it("los demás idiomas caen al inglés en vez de romperse", () => {
    for (const language of supportedLanguages) {
      const t = patternsCopy(language);
      expect(t.section.title.length).toBeGreaterThan(0);
      expect(t.hintGeneral(30, 45)).toContain("45");
    }
    expect(patternsCopy("fr")).toBe(patternsCopy("en"));
  });
});

describe("el modo foco solo se ofrece donde tiene sentido (la UI usa la misma regla)", () => {
  const calendar = readFileSync("components/calendar-view.tsx", "utf8");

  it("el botón de foco de la fila y el de la tarjeta de 'ahora' pasan por canFocusTask", () => {
    const card = readFileSync("components/now-card.tsx", "utf8");
    expect(calendar).toMatch(/import \{ canFocusTask \}/);
    expect(calendar.match(/canFocusTask\(/g)).toHaveLength(1);
    expect(card.match(/canFocusTask\(/g)).toHaveLength(1);
    // La regla vieja (todo lo que no sea proyecto) no puede volver.
    expect(calendar).not.toMatch(/!task\.done && task\.kind !== "project" && \(\s*<button\s+onClick=\{onFocus\}/);
  });
});
