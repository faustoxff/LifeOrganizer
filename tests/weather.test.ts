import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyWeather, clearWeatherCache, fetchWeather, FORECAST_DAYS, roundCoordinate, validCoordinates } from "@/lib/weather";

describe("classifyWeather", () => {
  it("la lluvia manda sobre el frío y el frío sobre el calor", () => {
    expect(classifyWeather({ maxC: 8, minC: 2, rainProbability: 80 })).toBe("rain");
    expect(classifyWeather({ maxC: 8, minC: 2, rainProbability: 10 })).toBe("cold");
    expect(classifyWeather({ maxC: 33, minC: 22, rainProbability: 10 })).toBe("hot");
    expect(classifyWeather({ maxC: 22, minC: 14, rainProbability: 20 })).toBeNull();
  });

  it("los bordes: 50 % es lluvia, 12 °C es frío, 28 °C es calor", () => {
    expect(classifyWeather({ maxC: 20, minC: 10, rainProbability: 50 })).toBe("rain");
    expect(classifyWeather({ maxC: 20, minC: 10, rainProbability: 49 })).toBeNull();
    expect(classifyWeather({ maxC: 12, minC: 5, rainProbability: 0 })).toBe("cold");
    expect(classifyWeather({ maxC: 13, minC: 5, rainProbability: 0 })).toBeNull();
    expect(classifyWeather({ maxC: 28, minC: 20, rainProbability: 0 })).toBe("hot");
  });
});

describe("coordenadas", () => {
  it("se redondean a 0,1°", () => {
    expect(roundCoordinate(-34.60372)).toBe(-34.6);
    expect(roundCoordinate(-58.38162)).toBe(-58.4);
  });

  it("valida rangos y tipos", () => {
    expect(validCoordinates(-34.6, -58.4)).toBe(true);
    expect(validCoordinates(91, 0)).toBe(false);
    expect(validCoordinates(0, 181)).toBe(false);
    expect(validCoordinates("1", 2)).toBe(false);
    expect(validCoordinates(NaN, 2)).toBe(false);
  });
});

describe("fetchWeather", () => {
  beforeEach(() => clearWeatherCache());

  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));
  const forecast = (max: number, min: number, rain: number | null) => ({
    daily: { temperature_2m_max: [max], temperature_2m_min: [min], precipitation_probability_max: [rain] }
  });
  const place = { lat: -34.6037, lon: -58.3816 };

  it("consulta Open-Meteo con la ubicación redondeada y clasifica", async () => {
    const fetchMock = reply(forecast(9, 3, 20));
    expect(await fetchWeather(place, "2026-07-10", 0, fetchMock)).toBe("cold");
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain("api.open-meteo.com");
    expect(url).toContain("latitude=-34.6&longitude=-58.4");
    expect(url).toContain("start_date=2026-07-10&end_date=2026-07-10");
    // Nunca la ubicación exacta.
    expect(url).not.toContain("34.6037");
  });

  it("guarda en caché por lugar y día", async () => {
    const fetchMock = reply(forecast(30, 20, 0));
    await fetchWeather(place, "2026-01-10", 1, fetchMock);
    await fetchWeather(place, "2026-01-10", 1, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchWeather(place, "2026-01-11", 2, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fuera del pronóstico no consulta", async () => {
    const fetchMock = reply(forecast(1, 1, 1));
    expect(await fetchWeather(place, "2026-01-10", -1, fetchMock)).toBeNull();
    expect(await fetchWeather(place, "2026-01-10", FORECAST_DAYS, fetchMock)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cualquier fallo devuelve null, nunca lanza", async () => {
    expect(await fetchWeather(place, "2026-01-10", 0, reply({}, false))).toBeNull();
    expect(await fetchWeather(place, "2026-01-11", 0, reply({ daily: {} }))).toBeNull();
    expect(await fetchWeather(place, "2026-01-12", 0, reply(null))).toBeNull();
    expect(await fetchWeather(place, "2026-01-13", 0, vi.fn(async () => { throw new Error("sin red"); }))).toBeNull();
  });

  it("sin probabilidad de lluvia usa 0", async () => {
    expect(await fetchWeather(place, "2026-01-14", 0, reply(forecast(20, 12, null)))).toBeNull();
  });
});
