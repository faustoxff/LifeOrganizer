import { describe, expect, it } from "vitest";
import type { RecurrenceRule } from "@/types/task";
import {
  addDays,
  isDateKey,
  normalizeRepeat,
  occurrencesBetween,
  ruleFromRepeat,
  weekdayOf
} from "@/lib/recurrence";

// 2026-09-28 es lunes.
const MON = "2026-09-28";

describe("occurrencesBetween: diario", () => {
  it("devuelve todos los días de la ventana, ambos extremos incluidos", () => {
    const dates = occurrencesBetween({ freq: "daily", interval: 1 }, MON, null, MON, "2026-10-01");
    expect(dates).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
  });

  it("cada 3 días cuenta desde starts_on, no desde el inicio de la ventana", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 3 };
    expect(occurrencesBetween(rule, MON, null, "2026-09-29", "2026-10-08")).toEqual([
      "2026-10-01", "2026-10-04", "2026-10-07"
    ]);
  });
});

describe("occurrencesBetween: semanal", () => {
  it("varios días por semana (miércoles y sábados)", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, weekdays: [3, 6] };
    expect(occurrencesBetween(rule, MON, null, MON, "2026-10-11")).toEqual([
      "2026-09-30", "2026-10-03", "2026-10-07", "2026-10-10"
    ]);
    for (const date of occurrencesBetween(rule, MON, null, MON, "2026-12-31")) {
      expect([3, 6]).toContain(weekdayOf(date));
    }
  });

  it("sin weekdays repite el día de la semana de starts_on", () => {
    expect(
      occurrencesBetween({ freq: "weekly", interval: 1 }, MON, null, MON, "2026-10-14")
    ).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
  });

  it("cada 2 semanas salta las intermedias", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 2, weekdays: [1, 4] };
    expect(occurrencesBetween(rule, MON, null, MON, "2026-10-31")).toEqual([
      "2026-09-28", "2026-10-01", "2026-10-12", "2026-10-15", "2026-10-26", "2026-10-29"
    ]);
  });

  it("cada 2 semanas respeta la ventana aunque empiece a mitad de ciclo", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 2, weekdays: [1] };
    // Lunes 5/10 es la semana "off": la ventana lo saltea, 12/10 entra.
    expect(occurrencesBetween(rule, MON, null, "2026-10-05", "2026-10-13")).toEqual(["2026-10-12"]);
  });

  it("las semanas van de lunes a domingo (domingo cierra la semana)", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 2, weekdays: [1, 0] };
    // Semana de arranque: lun 28/9 y dom 4/10. Semana off: 5/10 y 11/10.
    expect(occurrencesBetween(rule, MON, null, MON, "2026-10-13")).toEqual([
      "2026-09-28", "2026-10-04", "2026-10-12"
    ]);
  });
});

describe("occurrencesBetween: mensual", () => {
  it("monthDay 31 cae en el último día de los meses más cortos", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, monthDay: 31 };
    expect(occurrencesBetween(rule, "2026-01-31", null, "2026-01-01", "2026-06-30")).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"
    ]);
  });

  it("en año bisiesto febrero llega al 29", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, monthDay: 31 };
    expect(occurrencesBetween(rule, "2028-01-31", null, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("sin monthDay usa el día de starts_on", () => {
    expect(
      occurrencesBetween({ freq: "monthly", interval: 1 }, "2026-09-15", null, "2026-09-01", "2026-12-31")
    ).toEqual(["2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15"]);
  });

  it("cada 2 meses", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 2, monthDay: 10 };
    expect(occurrencesBetween(rule, "2026-09-10", null, "2026-09-01", "2027-01-31")).toEqual([
      "2026-09-10", "2026-11-10", "2027-01-10"
    ]);
  });
});

describe("occurrencesBetween: límites", () => {
  const rule: RecurrenceRule = { freq: "daily", interval: 1 };

  it("ends_on corta la serie, inclusive", () => {
    expect(occurrencesBetween(rule, MON, "2026-09-30", MON, "2026-10-10")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30"
    ]);
  });

  it("nunca devuelve fechas anteriores a starts_on", () => {
    expect(occurrencesBetween(rule, "2026-10-01", null, "2026-09-20", "2026-10-02")).toEqual([
      "2026-10-01", "2026-10-02"
    ]);
  });

  it("ventana vacía o serie ya terminada devuelve []", () => {
    expect(occurrencesBetween(rule, MON, null, "2026-10-05", "2026-10-01")).toEqual([]);
    expect(occurrencesBetween(rule, MON, "2026-09-01", "2026-10-01", "2026-10-10")).toEqual([]);
  });

  it("cruza cambios de horario de verano sin correr los días", () => {
    const dates = occurrencesBetween(rule, "2026-03-01", null, "2026-03-01", "2026-04-30");
    expect(dates).toHaveLength(61);
    expect(dates[60]).toBe("2026-04-30");
  });
});

describe("normalizeRepeat", () => {
  it("completa interval con 1 y normaliza weekdays", () => {
    expect(normalizeRepeat({ freq: "weekly", weekdays: [6, 3, 3] })).toEqual({
      freq: "weekly", interval: 1, weekdays: [3, 6]
    });
  });

  it("freq inválida descarta el repeat", () => {
    expect(normalizeRepeat({ freq: "hourly" })).toBeNull();
    expect(normalizeRepeat({})).toBeNull();
    expect(normalizeRepeat(null)).toBeNull();
    expect(normalizeRepeat("weekly")).toBeNull();
  });

  it("weekdays fuera de rango descarta el repeat, no lo filtra", () => {
    expect(normalizeRepeat({ freq: "weekly", weekdays: [3, 9] })).toBeNull();
    expect(normalizeRepeat({ freq: "weekly", weekdays: [-1] })).toBeNull();
    expect(normalizeRepeat({ freq: "weekly", weekdays: [1.5] })).toBeNull();
    expect(normalizeRepeat({ freq: "weekly", weekdays: "3" })).toBeNull();
  });

  it("interval y monthDay inválidos descartan el repeat", () => {
    expect(normalizeRepeat({ freq: "daily", interval: 0 })).toBeNull();
    expect(normalizeRepeat({ freq: "daily", interval: 2.5 })).toBeNull();
    expect(normalizeRepeat({ freq: "daily", interval: 100000 })).toBeNull();
    expect(normalizeRepeat({ freq: "monthly", monthDay: 32 })).toBeNull();
    expect(normalizeRepeat({ freq: "monthly", monthDay: 0 })).toBeNull();
  });

  it("weekdays solo aplica a weekly y monthDay solo a monthly", () => {
    expect(normalizeRepeat({ freq: "daily", weekdays: [1] })).toEqual({ freq: "daily", interval: 1 });
    expect(normalizeRepeat({ freq: "weekly", monthDay: 5 })).toEqual({ freq: "weekly", interval: 1 });
    expect(normalizeRepeat({ freq: "monthly", monthDay: 31 })).toEqual({ freq: "monthly", interval: 1, monthDay: 31 });
  });

  it("until válido se conserva; uno ilegible se ignora sin perder la serie", () => {
    expect(normalizeRepeat({ freq: "daily", until: "2026-12-31" })?.until).toBe("2026-12-31");
    expect(normalizeRepeat({ freq: "daily", until: "2026-02-31" })).toEqual({ freq: "daily", interval: 1 });
    expect(normalizeRepeat({ freq: "daily", until: "mañana" })).toEqual({ freq: "daily", interval: 1 });
  });

  it("ruleFromRepeat separa el until, que va a ends_on", () => {
    const repeat = normalizeRepeat({ freq: "weekly", weekdays: [3], until: "2026-12-31" });
    expect(repeat && ruleFromRepeat(repeat)).toEqual({ freq: "weekly", interval: 1, weekdays: [3] });
  });
});

describe("helpers de fecha", () => {
  it("isDateKey rechaza fechas que no existen", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-31")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("26-02-28")).toBe(false);
    expect(isDateKey(20260228)).toBe(false);
  });

  it("addDays cruza meses y años", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
