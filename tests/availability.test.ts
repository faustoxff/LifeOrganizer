import { describe, expect, it } from "vitest";
import {
  capacityOn,
  DEFAULT_AVAILABILITY,
  parseAvailability,
  parseOverrides,
  readAvailability,
  readOverrides
} from "@/lib/availability";

describe("DEFAULT_AVAILABILITY", () => {
  it("lunes a viernes 120, sábado 180, domingo 60", () => {
    expect(DEFAULT_AVAILABILITY).toEqual({
      "0": 60, "1": 120, "2": 120, "3": 120, "4": 120, "5": 120, "6": 180
    });
  });
});

describe("parseAvailability", () => {
  it("acepta los siete días con minutos válidos", () => {
    expect(parseAvailability({ ...DEFAULT_AVAILABILITY, "3": 0 })).toEqual({ ...DEFAULT_AVAILABILITY, "3": 0 });
  });

  it("rechaza un día faltante, en vez de leerlo como 0", () => {
    const partial: Record<string, number> = { ...DEFAULT_AVAILABILITY };
    delete partial["4"];
    expect(parseAvailability(partial)).toBeNull();
  });

  it("rechaza minutos inválidos", () => {
    for (const bad of [-1, 1441, 12.5, "60", null, NaN]) {
      expect(parseAvailability({ ...DEFAULT_AVAILABILITY, "1": bad })).toBeNull();
    }
    expect(parseAvailability(null)).toBeNull();
    expect(parseAvailability([1, 2, 3])).toBeNull();
    expect(parseAvailability("x")).toBeNull();
  });
});

describe("parseOverrides", () => {
  it("acepta fechas reales con minutos válidos", () => {
    expect(parseOverrides({ "2026-10-02": 0, "2026-10-03": 45 })).toEqual({ "2026-10-02": 0, "2026-10-03": 45 });
    expect(parseOverrides(undefined)).toEqual({});
    expect(parseOverrides(null)).toEqual({});
  });

  it("una entrada inválida invalida todo el objeto", () => {
    expect(parseOverrides({ "2026-02-31": 0 })).toBeNull();
    expect(parseOverrides({ viernes: 0 })).toBeNull();
    expect(parseOverrides({ "2026-10-02": -5 })).toBeNull();
    expect(parseOverrides([])).toBeNull();
  });

  it("limita la cantidad", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 367; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      many[d] = 0;
    }
    expect(parseOverrides(many)).toBeNull();
  });
});

describe("lectura tolerante desde la base", () => {
  it("una disponibilidad ilegible cae en el default", () => {
    expect(readAvailability(null)).toEqual(DEFAULT_AVAILABILITY);
    expect(readAvailability({ "0": "mucho" })).toEqual(DEFAULT_AVAILABILITY);
  });

  it("los overrides ilegibles se descartan uno por uno", () => {
    expect(readOverrides({ "2026-10-02": 30, basura: 5, "2026-10-03": -1 })).toEqual({ "2026-10-02": 30 });
    expect(readOverrides(null)).toEqual({});
  });
});

describe("capacityOn", () => {
  // 2026-09-28 es lunes.
  it("usa el valor del día de la semana", () => {
    expect(capacityOn("2026-09-28", DEFAULT_AVAILABILITY)).toBe(120);
    expect(capacityOn("2026-10-03", DEFAULT_AVAILABILITY)).toBe(180); // sábado
    expect(capacityOn("2026-10-04", DEFAULT_AVAILABILITY)).toBe(60); // domingo
  });

  it("un override reemplaza el valor, no se suma", () => {
    expect(capacityOn("2026-09-30", DEFAULT_AVAILABILITY, { "2026-09-30": 0 })).toBe(0);
    expect(capacityOn("2026-09-30", DEFAULT_AVAILABILITY, { "2026-09-30": 300 })).toBe(300);
    expect(capacityOn("2026-10-01", DEFAULT_AVAILABILITY, { "2026-09-30": 0 })).toBe(120);
  });
});
