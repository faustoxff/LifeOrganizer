import { normalizeText } from "@/lib/text-normalize";

/**
 * Datos que Spark no guarda como "hechos" del usuario: salud, finanzas, identificadores
 * y creencias. Es una lista de palabras en varios idiomas, no un clasificador: atrapa lo
 * obvio ("tengo diabetes", "gano 800 mil", un mail, un teléfono) y deja pasar lo que no
 * reconoce. Por eso es una capa de tres (el prompt, este filtro, y la pantalla donde el
 * usuario borra lo que quiera), y por eso prefiere de más antes que de menos: un hecho
 * legítimo rechazado se vuelve a decir; uno sensible guardado no se puede des-guardar.
 *
 * Todo el matching es sobre texto normalizado (minúsculas, sin acentos).
 */

export type SensitiveCategory = "health" | "finance" | "identifier" | "belief";

const word = (stems: string[]) => new RegExp(`\\b(?:${stems.join("|")})`);

const HEALTH = word([
  "enferm", "diagnostic", "diabet", "cancer", "depresion", "deprimid", "ansiedad", "bipolar",
  "esquizofren", "epilep", "asma\\b", "medicacion", "medicament", "pastilla", "tratamiento",
  "terapia", "psicolog", "psiquiatr", "embaraz", "discapacidad", "alergi", "vih\\b", "hiv\\b",
  "adiccion", "alcoholi", "trastorno", "cirugia", "dolor cronico", "sindrome", "hipertension",
  "colesterol", "salud\\b", "tdah", "autis", "anorexi", "bulimi", "suicid", "quimio",
  "illness", "disease", "diagnos", "medication", "therap", "pregnan", "disabilit", "allerg",
  "surgery", "anxiety", "depress", "disorder", "addict", "chronic", "health\\b", "adhd",
  "doenca", "saude", "remedio", "gravida", "maladie", "sante", "krankheit", "gesundheit",
  "malattia", "salute"
]);

const FINANCE = word([
  "sueldo", "salario", "ingresos\\b", "ingreso mensual", "deuda", "prestamo", "credito", "hipoteca", "tarjeta",
  "cbu\\b", "cvu\\b", "cuenta bancaria", "inversion", "invert", "ahorro", "impuesto", "dinero",
  "plata\\b", "cobro\\b", "quiebra", "jubilacion", "pension",
  "salary", "income", "debt", "loan", "mortgage", "credit", "bank account", "savings", "invest",
  "tax\\b", "taxes", "money", "wage", "bankrupt",
  "divida", "dinheiro", "emprestimo", "salaire", "argent", "gehalt", "schulden", "stipendio",
  "debito"
]);

const IDENTIFIER_WORDS = word([
  "dni\\b", "pasaporte", "passport", "cuil\\b", "cuit\\b", "ssn\\b", "social security", "iban\\b",
  "contrasena", "password", "direccion", "domicilio", "address", "codigo postal", "zip code",
  "patente", "licencia de conducir", "driver.?s license", "numero de (?:telefono|cuenta|documento|tarjeta|celular)"
]);
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/;
const PHONE = /(?:\+|\b)\d[\d\s().-]{7,}\d/;
const LONG_DIGITS = /\d{9,}/;
const STREET = /\b(?:calle|av\.?|avenida|street|st\.|rua|rue|strasse)\s+[a-z]+.*\d+/;

const BELIEF = word([
  "religi", "catolic", "evangelic", "musulman", "islam", "judio", "judia", "judaismo", "jewish", "hindu", "budis",
  "ateismo", "ateo\\b", "atea\\b", "atheis", "testigo de jehova", "politic", "voto\\b", "votar", "votante", "peronis", "orientacion sexual", "sexual orientation", "gay\\b",
  "lesbi", "bisexual", "transgener", "etnia", "raza\\b", "sindicat", "afiliad", "partido politico",
  "religiao", "religion", "politik", "politique"
]);

/** La categoría sensible que toca este texto, o null. Revisa clave y valor juntos. */
export function sensitiveCategory(text: string): SensitiveCategory | null {
  const normalized = normalizeText(text.replace(/_/g, " "));
  if (EMAIL.test(normalized) || PHONE.test(normalized) || LONG_DIGITS.test(normalized) || STREET.test(normalized)) {
    return "identifier";
  }
  if (IDENTIFIER_WORDS.test(normalized)) return "identifier";
  if (HEALTH.test(normalized)) return "health";
  if (FINANCE.test(normalized)) return "finance";
  if (BELIEF.test(normalized)) return "belief";
  return null;
}
