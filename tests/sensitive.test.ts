import { describe, expect, it } from "vitest";
import { sensitiveCategory } from "@/lib/sensitive";

describe("sensitiveCategory: lo que NO se guarda", () => {
  const blocked: Array<[string, string]> = [
    ["tengo diabetes", "health"],
    ["Tomo medicación todos los días", "health"],
    ["voy a terapia los jueves", "health"],
    ["estoy embarazada", "health"],
    ["I have anxiety", "health"],
    ["sufre depresión", "health"],
    ["tiene TDAH", "health"],
    ["mi salud mental", "health"],
    ["gano 800 mil de sueldo", "finance"],
    ["tengo una deuda con el banco", "finance"],
    ["my salary is 5000", "finance"],
    ["pago la hipoteca", "finance"],
    ["mi tarjeta de crédito", "finance"],
    ["escribime a juan@example.com", "identifier"],
    ["mi celular es +54 11 5555 1234", "identifier"],
    ["mi dni es 30111222", "identifier"],
    ["pasaporte AB123456", "identifier"],
    ["vivo en calle San Martín 1234", "identifier"],
    ["la contraseña es hunter2", "identifier"],
    ["soy católico", "belief"],
    ["voto a tal partido político", "belief"],
    ["I am an atheist", "belief"],
    ["mi orientación sexual", "belief"]
  ];

  it.each(blocked)("%s → %s", (text, category) => {
    expect(sensitiveCategory(text)).toBe(category);
  });

  it("mira la clave y el valor juntos, y los guiones bajos cuentan como espacios", () => {
    expect(sensitiveCategory("problemas_de_salud")).toBe("health");
    expect(sensitiveCategory("hobby sueldo_mensual")).toBe("finance");
  });

  it("ignora acentos y mayúsculas", () => {
    expect(sensitiveCategory("DEPRESIÓN")).toBe("health");
    expect(sensitiveCategory("Tarjeta")).toBe("finance");
  });
});

describe("sensitiveCategory: lo que SÍ se guarda", () => {
  const allowed = [
    "es despistado, siempre se olvida las cosas",
    "rinde mejor a la mañana",
    "juega al pádel los martes",
    "va al gimnasio tres veces por semana",
    "estudia ingeniería",
    "trabaja de noche",
    "prefiere que le avisen 30 minutos antes",
    "le gusta correr",
    "vive con dos compañeros",
    "saluda a todos",
    "ingresó a la facultad en 2022",
    "va en taxi al trabajo",
    "usa calzado número 42"
  ];

  it.each(allowed)("%s", (text) => {
    expect(sensitiveCategory(text)).toBeNull();
  });
});
