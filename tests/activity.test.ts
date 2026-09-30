import { describe, expect, it } from "vitest";
import { ACTIVITY_KEYS, detectActivity, normalizeActivityKey, normalizeTitle } from "@/lib/activity";

describe("normalizeTitle", () => {
  it("minúsculas, sin acentos ni signos, espacios colapsados", () => {
    expect(normalizeTitle("  Ir al Gimnasio!! ")).toBe("ir al gimnasio");
    expect(normalizeTitle("Médico – 18:30")).toBe("medico 18 30");
  });
});

describe("detectActivity", () => {
  const cases: Array<[string, string | null]> = [
    ["Gimnasio", "gimnasio"],
    ["ir al gym", "gimnasio"],
    ["GIMNASIO 7am", "gimnasio"],
    ["Crossfit con Nico", "gimnasio"],
    ["salir a correr", "correr"],
    ["Running 10k", "correr"],
    ["pileta", "pileta"],
    ["Natación", "pileta"],
    ["ir a la playa", "playa"],
    ["pádel con los pibes", "deporte"],
    ["partido de fútbol", "deporte"],
    ["Yoga", "yoga"],
    ["cursar cálculo", "facultad"],
    ["Ir a la facultad", "facultad"],
    ["clase de inglés", "facultad"],
    ["ir a la oficina", "trabajo"],
    ["Viaje a Mendoza", "viaje"],
    ["vuelo a Madrid", "viaje"],
    ["preparar la valija", "viaje"],
    ["dentista", "medico"],
    ["turno médico", "medico"],
    ["Go to the gym", "gimnasio"],
    ["swimming lesson", "pileta"],
    ["Flight to Berlin", "viaje"],
    // No son ir a la actividad:
    ["llamar al médico", null],
    ["pedir turno con el dentista", null],
    ["comprar pasajes de viaje", null],
    ["pagar el gimnasio", null],
    ["renovar la cuota del gym", null],
    // Ni una cosa ni la otra:
    ["hacer las compras", null],
    ["entregar el TP de álgebra", null],
    ["", null]
  ];

  it.each(cases)("%s → %s", (title, expected) => {
    expect(detectActivity(title)).toBe(expected);
  });

  it("lo específico le gana a lo general: natación no es 'deporte'", () => {
    expect(detectActivity("natación")).toBe("pileta");
    expect(detectActivity("gimnasio y luego pileta")).toBe("pileta");
  });

  it("solo devuelve claves del catálogo", () => {
    for (const [title] of cases) {
      const key = detectActivity(title);
      if (key) expect(ACTIVITY_KEYS).toContain(key);
    }
  });
});

describe("normalizeActivityKey", () => {
  it("lleva sinónimos a la clave del catálogo", () => {
    expect(normalizeActivityKey("Gym")).toBe("gimnasio");
    expect(normalizeActivityKey("Natación")).toBe("pileta");
    expect(normalizeActivityKey("universidad")).toBe("facultad");
    expect(normalizeActivityKey("gimnasio")).toBe("gimnasio");
  });

  it("una actividad nueva se normaliza a un slug", () => {
    expect(normalizeActivityKey("Peluquería")).toBe("peluqueria");
    expect(normalizeActivityKey("Clase de guitarra")).toBe("facultad"); // "clase" es del catálogo
    expect(normalizeActivityKey("Ir al cine")).toBe("ir_al_cine");
  });

  it("rechaza lo que no sirve", () => {
    for (const bad of ["", "   ", "!!", 5, null, undefined, "x".repeat(60)]) {
      expect(normalizeActivityKey(bad), String(bad)).toBeNull();
    }
  });
});
