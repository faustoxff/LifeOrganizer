import { describe, expect, it } from "vitest";
import { suggestKind } from "@/lib/task-kind";

const TODAY = "2026-09-28";

describe("suggestKind: recordatorio", () => {
  it("título corto + hora + verbo de acción puntual", () => {
    expect(suggestKind({ title: "Llamar al banco", time: "10:30", dueDate: TODAY, today: TODAY })).toBe("reminder");
    expect(suggestKind({ title: "Pagar la luz", time: "09:00", dueDate: TODAY, today: TODAY })).toBe("reminder");
    expect(suggestKind({ title: "Sacar turno con el dentista", time: "08:00", dueDate: TODAY, today: TODAY })).toBe("reminder");
    expect(suggestKind({ title: "Comprar pan", time: "18:00", dueDate: TODAY, today: TODAY })).toBe("reminder");
  });

  it("entiende inglés y no le importan los acentos ni las mayúsculas", () => {
    expect(suggestKind({ title: "CALL mom", time: "20:00", dueDate: TODAY, today: TODAY })).toBe("reminder");
    expect(suggestKind({ title: "Renovár el carnet", time: "11:00", dueDate: TODAY, today: TODAY })).toBe("reminder");
  });

  it("sin hora es una tarea, aunque el verbo sea de recordatorio", () => {
    expect(suggestKind({ title: "Llamar al banco", dueDate: TODAY, today: TODAY })).toBe("task");
  });

  it("con hora pero sin verbo puntual sigue siendo una tarea", () => {
    expect(suggestKind({ title: "Reunión de equipo", time: "15:00", dueDate: TODAY, today: TODAY })).toBe("task");
  });

  it("un título largo no es un recordatorio", () => {
    const title = "Llamar al banco para consultar por el préstamo hipotecario y la tasa";
    expect(suggestKind({ title, time: "10:00", dueDate: TODAY, today: TODAY })).toBe("task");
  });

  it("no se enciende por una palabra que solo contiene el verbo", () => {
    expect(suggestKind({ title: "Apagar la compu", time: "23:00", dueDate: TODAY, today: TODAY })).toBe("task");
  });
});

describe("suggestKind: proyecto", () => {
  it("una entrega a más de 3 días es un proyecto", () => {
    expect(suggestKind({ title: "Entrega del TP de álgebra", dueDate: "2026-10-09", today: TODAY })).toBe("project");
    expect(suggestKind({ title: "Parcial de cálculo", dueDate: "2026-10-05", today: TODAY })).toBe("project");
    expect(suggestKind({ title: "Informe final", dueDate: "2026-10-12", today: TODAY })).toBe("project");
    expect(suggestKind({ title: "Proyecto de la facultad", dueDate: "2026-10-20", today: TODAY })).toBe("project");
  });

  it("las palabras también cuentan cuando están en la descripción", () => {
    expect(
      suggestKind({ title: "Cálculo", description: "Preparar el parcial del jueves 8", dueDate: "2026-10-08", today: TODAY })
    ).toBe("project");
  });

  it("una descripción larga a más de 3 días es un proyecto", () => {
    expect(
      suggestKind({ title: "Mudanza", description: "x".repeat(300), dueDate: "2026-10-10", today: TODAY })
    ).toBe("project");
  });

  it("el mismo texto para mañana o pasado es una tarea", () => {
    expect(suggestKind({ title: "Entrega del TP de álgebra", dueDate: "2026-09-29", today: TODAY })).toBe("task");
    expect(suggestKind({ title: "Entrega del TP", dueDate: "2026-10-01", today: TODAY })).toBe("task");
    expect(suggestKind({ title: "Mudanza", description: "x".repeat(300), dueDate: TODAY, today: TODAY })).toBe("task");
  });

  it("sin fecha lejana una palabra de entrega no alcanza para proyecto", () => {
    expect(suggestKind({ title: "Ordenar los papeles", dueDate: "2026-10-10", today: TODAY })).toBe("task");
    expect(suggestKind({ title: "Entrega del TP" })).toBe("task");
  });
});

describe("suggestKind: el resto", () => {
  it("una tarea común es una tarea", () => {
    expect(suggestKind({ title: "Estudiar historia", dueDate: "2026-09-30", today: TODAY })).toBe("task");
    expect(suggestKind({ title: "" })).toBe("task");
  });
});
