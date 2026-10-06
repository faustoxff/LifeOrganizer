import { describe, expect, it } from "vitest";
import { createCardTitle } from "@/lib/create-title";
import { copy, supportedLanguages } from "@/lib/i18n";

const labels = { createTask: "Crear tarea", createReminder: "Crear recordatorio", createProject: "Crear proyecto" };
const all = (n: number) => `Crear ${n} elementos`;

describe("título de la tarjeta de confirmación", () => {
  it("un solo ítem: el nombre de su tipo", () => {
    expect(createCardTitle(["reminder"], labels, all)).toBe("Crear recordatorio");
    expect(createCardTitle(["task"], labels, all)).toBe("Crear tarea");
    expect(createCardTitle(["project"], labels, all)).toBe("Crear proyecto");
  });

  it("varios del mismo tipo: con la cantidad entre paréntesis", () => {
    expect(createCardTitle(["task", "task", "task"], labels, all)).toBe("Crear tarea (3)");
    expect(createCardTitle(["reminder", "reminder"], labels, all)).toBe("Crear recordatorio (2)");
    expect(createCardTitle(["project", "project"], labels, all)).toBe("Crear proyecto (2)");
  });

  it("tipos mezclados: 'Crear N elementos'", () => {
    expect(createCardTitle(["task", "reminder"], labels, all)).toBe("Crear 2 elementos");
    expect(createCardTitle(["task", "task", "project"], labels, all)).toBe("Crear 3 elementos");
  });

  it("sin ítems cae a 'Crear tarea'", () => {
    expect(createCardTitle([], labels, all)).toBe("Crear tarea");
  });

  it("los 13 idiomas tienen los dos textos nuevos", () => {
    for (const language of supportedLanguages) {
      expect(copy[language].milo.createReminder.length, language).toBeGreaterThan(0);
      expect(copy[language].milo.createProject.length, language).toBeGreaterThan(0);
    }
    expect(copy.es.milo.createReminder).toBe("Crear recordatorio");
    expect(copy.en.milo.createProject).toBe("Create project");
  });
});
