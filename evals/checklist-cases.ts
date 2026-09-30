import type { Season, Weather } from "@/lib/checklist";
import type { AppLanguage } from "@/lib/i18n";
import type { UserFact } from "@/lib/user-facts";

/**
 * Casos del eval de checklists, contra los modelos de verdad. Lo que se mide es lo que decide
 * el modelo: qué ítems propone, con qué condición (época / clima) los marca, y si respeta lo que
 * se sabe de la persona. La selección de cada día la hace código (`selectItems`) y tiene sus
 * propios tests: acá se juzga la lista que sale de aplicarla al contexto del caso.
 */

const fact = (key: string, value: string): UserFact => ({
  id: key,
  key,
  value,
  source: "stated",
  confidence: 1,
  updatedAt: "2026-07-01T00:00:00.000Z"
});

export type GenerateCase = {
  name: string;
  activityKey: string;
  title: string;
  facts: UserFact[];
  season: Season | null;
  weather: Weather | null;
  language: AppLanguage;
  expect: {
    /** Cada patrón tiene que estar en la lista del día (los ítems que entran hoy). */
    include: RegExp[];
    /** Ninguno puede estar en la lista del día. */
    exclude: RegExp[];
    /** Los condicionales que hoy no aplican tienen que existir en la lista guardada (para otro día). */
    storedConditional?: Array<{ pattern: RegExp; season?: Season; weather?: Weather }>;
    minItems: number;
  };
};

// Ropa de abrigo, lluvia, sol: las tres familias que separan un día de otro.
const WARM = /campera|abrigo|buzo|polar|sweater|su[eé]ter|chaqueta|jacket|hoodie|c[aá]lid|guantes|bufanda|gorro de lana/i;
const RAIN = /paraguas|impermeable|piloto|capa de lluvia|rain|umbrella|chubasquero|k-way|kway/i;
const SUN = /protector solar|bloqueador|crema solar|sunscreen|gorra|sombrero|anteojos de sol|lentes de sol|sun ?hat|sunglasses/i;
const WATER = /agua|botella|bidón|bidon|hidrat|water|bottle/i;
const PHONE = /celular|tel[eé]fono|m[oó]vil|phone/i;

export const GENERATE_CASES: GenerateCase[] = [
  {
    name: "despistado va al gimnasio en invierno con lluvia",
    activityKey: "gimnasio",
    title: "Gimnasio",
    facts: [fact("es_despistado", "sí, siempre se olvida las cosas"), fact("deportes", "pesas y gimnasio")],
    season: "winter",
    weather: "rain",
    language: "es",
    expect: {
      // La lista de hoy: lo de siempre (agua, celular) más lo que este día pide (abrigo y algo para la lluvia).
      include: [WATER, PHONE, WARM, RAIN],
      exclude: [SUN],
      // Y la guardada tiene lo del verano y el calor para otro día.
      storedConditional: [{ pattern: SUN, season: "summer" }],
      minItems: 6
    }
  },
  {
    name: "correr en verano con calor",
    activityKey: "correr",
    title: "Salir a correr",
    facts: [],
    season: "summer",
    weather: "hot",
    language: "es",
    expect: {
      include: [WATER, SUN],
      exclude: [WARM, RAIN],
      minItems: 5
    }
  },
  {
    name: "pádel: se acuerda de lo que dijo el usuario",
    activityKey: "deporte",
    title: "Pádel con los chicos",
    facts: [fact("deportes", "juega al pádel los martes")],
    season: null,
    weather: null,
    language: "es",
    expect: {
      include: [WATER, /paleta|raqueta|pala\b|racket/i, /pelota|bolas|balls/i],
      exclude: [WARM, SUN, RAIN],
      minItems: 5
    }
  },
  {
    name: "viaje: documentos y cargador, en inglés",
    activityKey: "viaje",
    title: "Flight to Berlin",
    facts: [fact("es_despistado", "yes, forgets things a lot")],
    season: null,
    weather: null,
    language: "en",
    expect: {
      include: [/passport|id\b|documents?/i, /charger|cable|adapter/i, PHONE],
      exclude: [],
      minItems: 6
    }
  }
];

export type ClassifyCase = { title: string; expected: "any" | "none" | string };

/**
 * "any" = tiene que ser una actividad (cualquier clave), "none" = no, o una clave del catálogo.
 * Los mandados no son actividades: es el error más caro, porque muestra una checklist donde no va.
 */
export const CLASSIFY_CASES: ClassifyCase[] = [
  { title: "Gimnasio 7am con Nico", expected: "gimnasio" },
  { title: "Ir al dentista", expected: "medico" },
  { title: "Clase de guitarra", expected: "any" },
  { title: "Peluquería", expected: "any" },
  { title: "Torneo de ajedrez", expected: "any" },
  { title: "Pagar la luz", expected: "none" },
  { title: "Llamar a mamá", expected: "none" },
  { title: "Entregar el TP de historia", expected: "none" },
  { title: "Comprar leche", expected: "none" },
  { title: "Limpiar el departamento", expected: "none" }
];
