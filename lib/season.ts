/**
 * Época del año según el hemisferio, que se deduce de la zona horaria: el usuario no lo
 * dice y no hace falta que lo diga. Verano e invierno son los tres meses centrales; el
 * resto del año no es ninguna de las dos (`null`), y ahí manda el clima, no el calendario.
 */

export type Hemisphere = "north" | "south";
export type Season = "summer" | "winter";

const SOUTH_PREFIXES = [
  "America/Argentina/", "Australia/", "Antarctica/", "Indian/Antananarivo", "Indian/Mauritius",
  "Indian/Reunion", "Indian/Comoro", "Indian/Mayotte"
];
const SOUTH_ZONES = new Set([
  "America/Sao_Paulo", "America/Santiago", "America/Montevideo", "America/Asuncion",
  "America/La_Paz", "America/Lima", "America/Cuiaba", "America/Campo_Grande", "America/Bahia",
  "America/Fortaleza", "America/Recife", "America/Maceio", "America/Belem", "America/Manaus",
  "America/Porto_Velho", "America/Rio_Branco", "America/Cordoba", "America/Buenos_Aires",
  "America/Mendoza", "America/Punta_Arenas", "Africa/Johannesburg", "Africa/Maputo",
  "Africa/Harare", "Africa/Lusaka", "Africa/Windhoek", "Africa/Gaborone", "Africa/Luanda",
  "Africa/Lubumbashi", "Africa/Blantyre", "Africa/Maseru", "Africa/Mbabane", "Africa/Dar_es_Salaam",
  "Pacific/Auckland", "Pacific/Fiji", "Pacific/Tongatapu", "Pacific/Apia", "Pacific/Noumea",
  "Pacific/Port_Moresby", "Pacific/Tahiti", "Pacific/Easter", "Pacific/Guadalcanal"
]);

export function hemisphereOf(timeZone: string): Hemisphere {
  if (SOUTH_ZONES.has(timeZone)) return "south";
  return SOUTH_PREFIXES.some((prefix) => timeZone.startsWith(prefix)) ? "south" : "north";
}

/** Verano o invierno en esa fecha ("YYYY-MM-DD"), o null en las estaciones de paso. */
export function seasonOf(date: string, hemisphere: Hemisphere): Season | null {
  const month = Number(date.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const northWinter = month === 12 || month <= 2;
  const northSummer = month >= 6 && month <= 8;
  if (hemisphere === "north") return northWinter ? "winter" : northSummer ? "summer" : null;
  return northWinter ? "summer" : northSummer ? "winter" : null;
}
