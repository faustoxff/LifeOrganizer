import { describe, expect, it } from "vitest";
import { copy, supportedLanguages } from "@/lib/i18n";

/** Los textos de checklists, "Lo que Spark sabe de vos" y los hechos del chat, en los 13 idiomas. */
describe("etapa 5: textos", () => {
  it("todo texto existe, no está vacío y los que llevan parámetro lo usan", () => {
    for (const language of supportedLanguages) {
      const c = copy[language].checklist;
      const k = copy[language].knowledge;
      const f = copy[language].facts;
      const where = (key: string) => `${language}.${key}`;

      for (const [name, text] of Object.entries({ ...c, ...c.weather, ...k, ...f })) {
        if (typeof text === "string") expect(text.trim().length, where(name)).toBeGreaterThan(0);
      }
      expect(c.chip(2, 5), where("chip")).toMatch(/2.*5/);
      expect(c.remindOn(30), where("remindOn")).toContain("30");
      expect(c.lead(60), where("lead")).toContain("60");
      expect(c.notifTitle("TITULO", "18:00"), where("notifTitle")).toMatch(/TITULO.*18:00/);
      expect(c.notifBody("AGUA, CELULAR"), where("notifBody")).toContain("AGUA, CELULAR");
      expect(k.items(7), where("items")).toContain("7");
      expect(k.locationSaved(-34.6, -58.4), where("locationSaved")).toMatch(/-34\.6.*-58\.4/);
      for (const weather of ["rain", "cold", "hot"] as const) expect(c.weather[weather].length).toBeGreaterThan(0);
    }
  });

  it("todos los idiomas tienen exactamente las mismas claves que el inglés (incluye estas secciones)", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value === null || typeof value !== "object"
        ? [prefix]
        : Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
    const reference = keys({ checklist: copy.en.checklist, knowledge: copy.en.knowledge, facts: copy.en.facts }).sort();
    for (const language of supportedLanguages) {
      const own = keys({ checklist: copy[language].checklist, knowledge: copy[language].knowledge, facts: copy[language].facts }).sort();
      expect(own, language).toEqual(reference);
    }
  });

  it("el aviso de privacidad de la pantalla nombra lo que no se guarda, en todos los idiomas", () => {
    for (const language of supportedLanguages) {
      expect(copy[language].knowledge.sensitive.length, language).toBeGreaterThan(20);
    }
  });
});
