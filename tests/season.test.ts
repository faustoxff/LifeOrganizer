import { describe, expect, it } from "vitest";
import { hemisphereOf, seasonOf } from "@/lib/season";

describe("hemisphereOf", () => {
  it("deduce el hemisferio de la zona horaria", () => {
    for (const zone of ["America/Argentina/Buenos_Aires", "America/Sao_Paulo", "America/Santiago", "Australia/Sydney", "Africa/Johannesburg", "Pacific/Auckland", "America/Montevideo"]) {
      expect(hemisphereOf(zone), zone).toBe("south");
    }
    for (const zone of ["Europe/Madrid", "America/New_York", "Asia/Tokyo", "America/Mexico_City", "UTC", "Africa/Cairo", "Something/Unknown"]) {
      expect(hemisphereOf(zone), zone).toBe("north");
    }
  });
});

describe("seasonOf", () => {
  it("el norte tiene el invierno en diciembre-febrero y el verano en junio-agosto", () => {
    expect(seasonOf("2026-01-15", "north")).toBe("winter");
    expect(seasonOf("2026-12-01", "north")).toBe("winter");
    expect(seasonOf("2026-07-10", "north")).toBe("summer");
  });

  it("el sur es al revés", () => {
    expect(seasonOf("2026-07-10", "south")).toBe("winter");
    expect(seasonOf("2026-01-15", "south")).toBe("summer");
    expect(seasonOf("2026-12-24", "south")).toBe("summer");
  });

  it("las estaciones de paso no son ni verano ni invierno", () => {
    for (const month of ["03", "04", "05", "09", "10", "11"]) {
      expect(seasonOf(`2026-${month}-10`, "north"), month).toBeNull();
      expect(seasonOf(`2026-${month}-10`, "south"), month).toBeNull();
    }
  });

  it("una fecha inválida no devuelve nada", () => {
    expect(seasonOf("nope", "north")).toBeNull();
    expect(seasonOf("2026-13-01", "north")).toBeNull();
  });
});
