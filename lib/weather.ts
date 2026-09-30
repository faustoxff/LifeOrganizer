import type { Weather } from "@/lib/checklist";

/**
 * El clima del día para decidir qué ítems de una checklist aplican. Open-Meteo es gratis y
 * no pide API key. Cualquier fallo (sin red, sin ubicación, fecha fuera del pronóstico)
 * devuelve null y la checklist se arma sin clima: el clima es un plus, nunca un requisito.
 */

export const RAIN_PROBABILITY = 50;
export const COLD_MAX_C = 12;
export const HOT_MAX_C = 28;
/** Open-Meteo pronostica 16 días; más allá de una semana no vale la pena confiar. */
export const FORECAST_DAYS = 7;
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;

export type DailyForecast = { maxC: number; minC: number; rainProbability: number };

/** Lluvia manda sobre el frío y el frío sobre el calor: es lo que más se nota al salir. */
export function classifyWeather(forecast: DailyForecast): Weather | null {
  if (forecast.rainProbability >= RAIN_PROBABILITY) return "rain";
  if (forecast.maxC <= COLD_MAX_C) return "cold";
  if (forecast.maxC >= HOT_MAX_C) return "hot";
  return null;
}

/** Redondea a 0,1° (~10 km): lo que se guarda y lo que se manda. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

export function validCoordinates(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" && typeof lon === "number" &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}

const cache = new Map<string, { at: number; value: Weather | null }>();

export function clearWeatherCache() {
  cache.clear();
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * El clima de `date` ("YYYY-MM-DD", en la zona del lugar) o null. `daysAhead` es cuántos
 * días faltan desde hoy: fuera de [0, FORECAST_DAYS) no se consulta.
 */
export async function fetchWeather(
  place: { lat: number; lon: number },
  date: string,
  daysAhead: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: number = Date.now()
): Promise<Weather | null> {
  if (daysAhead < 0 || daysAhead >= FORECAST_DAYS) return null;
  const lat = roundCoordinate(place.lat);
  const lon = roundCoordinate(place.lon);
  const key = `${lat},${lon},${date}`;

  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&start_date=${date}&end_date=${date}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      daily?: {
        temperature_2m_max?: Array<number | null>;
        temperature_2m_min?: Array<number | null>;
        precipitation_probability_max?: Array<number | null>;
      };
    };
    const maxC = body.daily?.temperature_2m_max?.[0];
    const minC = body.daily?.temperature_2m_min?.[0];
    const rain = body.daily?.precipitation_probability_max?.[0];
    if (typeof maxC !== "number" || typeof minC !== "number") return null;

    const value = classifyWeather({ maxC, minC, rainProbability: typeof rain === "number" ? rain : 0 });
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, { at: now, value });
    return value;
  } catch {
    return null;
  }
}
