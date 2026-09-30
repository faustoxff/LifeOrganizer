import { describe, expect, it } from "vitest";
import {
  deleteFollowing,
  deleteOnlyThis,
  editFollowing,
  ensureOccurrencesWith,
  SERIES_WINDOW_DAYS,
  type OccurrenceRef,
  type OccurrenceStore,
  type SeriesEditStore,
  type SeriesRecord
} from "@/lib/series";
import type { TaskStatus } from "@/types/task";

/**
 * Store en memoria que respeta lo que la base garantiza: el índice único
 * (series_id, occurrence_date) y el aislamiento por usuario. Lo que se prueba
 * es la lógica de lib/series.ts; el SQL real se verificó aparte contra Postgres.
 */
type Row = {
  id: string;
  userId: string;
  seriesId: string;
  date: string;
  status: TaskStatus;
  title: string;
};

class MemoryStore implements OccurrenceStore, SeriesEditStore {
  series: SeriesRecord[] = [];
  rows: Row[] = [];
  private next = 0;

  async listSeriesInWindow(userId: string, from: string, to: string) {
    return this.series.filter(
      (s) => s.userId === userId && s.active && s.startsOn <= to && (s.endsOn === null || s.endsOn >= from)
    );
  }

  async insertOccurrences(userId: string, series: SeriesRecord, dates: string[]) {
    let created = 0;
    for (const date of dates) {
      const exists = this.rows.some((r) => r.seriesId === series.id && r.date === date);
      if (exists) continue; // ON CONFLICT DO NOTHING
      this.rows.push({
        id: `o${this.next++}`, userId, seriesId: series.id, date, status: "pending", title: series.title
      });
      created += 1;
    }
    return created;
  }

  async skipPastPending(userId: string, today: string) {
    let n = 0;
    for (const r of this.rows) {
      if (r.userId === userId && r.status === "pending" && r.date < today) {
        r.status = "skipped";
        n += 1;
      }
    }
    return n;
  }

  async getOccurrence(userId: string, taskId: string): Promise<OccurrenceRef | null> {
    const r = this.rows.find((x) => x.id === taskId && x.userId === userId);
    return r ? { seriesId: r.seriesId, occurrenceDate: r.date, status: r.status } : null;
  }

  async getSeries(userId: string, seriesId: string) {
    // Una copia, como devuelve una base: quien la lea no ve cambios posteriores.
    const found = this.series.find((s) => s.id === seriesId && s.userId === userId);
    return found ? { ...found, rule: { ...found.rule } } : null;
  }

  async endSeries(userId: string, seriesId: string, endsOn: string, active: boolean) {
    const s = this.series.find((x) => x.id === seriesId && x.userId === userId);
    if (s) {
      s.endsOn = endsOn;
      s.active = active;
    }
  }

  async deleteOccurrencesFrom(userId: string, seriesId: string, fromDate: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) => !(r.userId === userId && r.seriesId === seriesId && r.date >= fromDate && r.status !== "done")
    );
    return before - this.rows.length;
  }

  async insertSeries(userId: string, series: SeriesRecord) {
    this.series.push({ ...series, userId });
  }

  async skipOccurrence(userId: string, taskId: string) {
    const r = this.rows.find((x) => x.id === taskId && x.userId === userId);
    if (!r) return false;
    r.status = "skipped";
    return true;
  }

  dates(seriesId: string, status?: TaskStatus) {
    return this.rows
      .filter((r) => r.seriesId === seriesId && (!status || r.status === status))
      .map((r) => r.date)
      .sort();
  }
}

const gym = (over: Partial<SeriesRecord> = {}): SeriesRecord => ({
  id: "gym",
  userId: "u1",
  kind: "task",
  title: "Gimnasio",
  category: "salud",
  description: "",
  priority: "medium",
  estimateMin: 60,
  time: "19:00",
  rule: { freq: "weekly", interval: 1, weekdays: [3, 6] },
  startsOn: "2026-09-28",
  endsOn: null,
  active: true,
  ...over
});

const MON = "2026-09-28";

describe("ensureOccurrencesWith", () => {
  it("crea las ocurrencias de hoy a hoy + 14 días", async () => {
    const store = new MemoryStore();
    store.series.push(gym());
    const result = await ensureOccurrencesWith(store, "u1", MON);
    expect(SERIES_WINDOW_DAYS).toBe(14);
    expect(result.created).toBe(4);
    expect(store.dates("gym")).toEqual(["2026-09-30", "2026-10-03", "2026-10-07", "2026-10-10"]);
  });

  it("es idempotente: correrla de nuevo no duplica nada", async () => {
    const store = new MemoryStore();
    store.series.push(gym(), gym({ id: "diaria", title: "Agua", rule: { freq: "daily", interval: 1 } }));
    await ensureOccurrencesWith(store, "u1", MON);
    const snapshot = JSON.stringify(store.rows);

    const again = await ensureOccurrencesWith(store, "u1", MON);
    expect(again).toEqual({ created: 0, skipped: 0 });
    expect(JSON.stringify(store.rows)).toBe(snapshot);
  });

  it("dos ejecuciones concurrentes tampoco duplican", async () => {
    const store = new MemoryStore();
    store.series.push(gym());
    await Promise.all([
      ensureOccurrencesWith(store, "u1", MON),
      ensureOccurrencesWith(store, "u1", MON)
    ]);
    expect(store.dates("gym")).toHaveLength(4);
  });

  it("al avanzar el día crea solo lo nuevo", async () => {
    const store = new MemoryStore();
    store.series.push(gym());
    await ensureOccurrencesWith(store, "u1", MON);
    const next = await ensureOccurrencesWith(store, "u1", "2026-10-05");
    // Ventana 5/10..19/10: ya estaban 7/10 y 10/10; se suman 14/10 y 17/10.
    expect(next.created).toBe(2);
    expect(store.dates("gym", "pending")).toEqual(["2026-10-07", "2026-10-10", "2026-10-14", "2026-10-17"]);
  });

  it("pasa a skipped lo pendiente que quedó atrás", async () => {
    const store = new MemoryStore();
    store.series.push(gym());
    await ensureOccurrencesWith(store, "u1", MON);
    const next = await ensureOccurrencesWith(store, "u1", "2026-10-05");
    expect(next.skipped).toBe(2);
    expect(store.dates("gym", "skipped")).toEqual(["2026-09-30", "2026-10-03"]);
  });

  it("no saltea lo hecho ni lo de hoy", async () => {
    const store = new MemoryStore();
    store.series.push(gym());
    await ensureOccurrencesWith(store, "u1", MON);
    store.rows.find((r) => r.date === "2026-09-30")!.status = "done";
    await ensureOccurrencesWith(store, "u1", "2026-10-03");
    expect(store.dates("gym", "done")).toEqual(["2026-09-30"]);
    expect(store.dates("gym", "pending")).toContain("2026-10-03");
  });

  it("una serie terminada o inactiva no genera nada", async () => {
    const store = new MemoryStore();
    store.series.push(
      gym({ id: "vieja", endsOn: "2026-09-29" }),
      gym({ id: "apagada", active: false })
    );
    await ensureOccurrencesWith(store, "u1", MON);
    expect(store.dates("vieja")).toEqual([]);
    expect(store.dates("apagada")).toEqual([]);
  });

  it("solo toca las series del usuario", async () => {
    const store = new MemoryStore();
    store.series.push(gym(), gym({ id: "ajena", userId: "u2" }));
    await ensureOccurrencesWith(store, "u1", MON);
    expect(store.dates("ajena")).toEqual([]);
    expect(store.dates("gym")).toHaveLength(4);
  });
});

describe("editFollowing (esta y las siguientes)", () => {
  async function setup() {
    const store = new MemoryStore();
    store.series.push(gym());
    await ensureOccurrencesWith(store, "u1", MON);
    return store;
  }
  const occurrenceOn = (store: MemoryStore, date: string) => store.rows.find((r) => r.date === date)!;

  it("termina la serie vieja el día anterior y crea una nueva desde esa fecha", async () => {
    const store = await setup();
    const target = occurrenceOn(store, "2026-10-07");

    const result = await editFollowing(store, "u1", target.id, { title: "Gym mañana", time: "07:00" }, "gym2");

    expect(result).toEqual({ ok: true, seriesId: "gym2" });
    expect(store.series.find((s) => s.id === "gym")).toMatchObject({ endsOn: "2026-10-06", active: true });
    expect(store.series.find((s) => s.id === "gym2")).toMatchObject({
      title: "Gym mañana", time: "07:00", startsOn: "2026-10-07", endsOn: null, active: true,
      rule: { freq: "weekly", interval: 1, weekdays: [3, 6] }
    });
  });

  it("borra las ocurrencias futuras pendientes de la vieja y conserva las anteriores", async () => {
    const store = await setup();
    await editFollowing(store, "u1", occurrenceOn(store, "2026-10-07").id, { title: "Nuevo" }, "gym2");
    expect(store.dates("gym")).toEqual(["2026-09-30", "2026-10-03"]);
  });

  it("al materializar, las ocurrencias nuevas salen de la serie nueva, sin duplicar fechas", async () => {
    const store = await setup();
    await editFollowing(store, "u1", occurrenceOn(store, "2026-10-07").id, { title: "Nuevo" }, "gym2");
    await ensureOccurrencesWith(store, "u1", MON);
    expect(store.dates("gym2")).toEqual(["2026-10-07", "2026-10-10"]);
    const all = store.rows.map((r) => r.date);
    expect(new Set(all).size).toBe(all.length);
    expect(store.rows.filter((r) => r.seriesId === "gym2").every((r) => r.title === "Nuevo")).toBe(true);
  });

  it("no toca lo hecho de la serie vieja", async () => {
    const store = await setup();
    occurrenceOn(store, "2026-10-10").status = "done";
    await editFollowing(store, "u1", occurrenceOn(store, "2026-10-07").id, { title: "Nuevo" }, "gym2");
    expect(store.dates("gym")).toEqual(["2026-09-30", "2026-10-03", "2026-10-10"]);
  });

  it("editar desde la primera ocurrencia deja la serie vieja sin fechas y la desactiva", async () => {
    const store = new MemoryStore();
    store.series.push(gym({ startsOn: "2026-09-30" }));
    await ensureOccurrencesWith(store, "u1", MON);
    await editFollowing(store, "u1", occurrenceOn(store, "2026-09-30").id, { title: "Otro" }, "gym2");
    expect(store.series.find((s) => s.id === "gym")).toMatchObject({ active: false, endsOn: "2026-09-29" });
    expect(store.dates("gym")).toEqual([]);
  });

  it("conserva el ends_on original en la serie nueva", async () => {
    const store = new MemoryStore();
    store.series.push(gym({ endsOn: "2026-12-31" }));
    await ensureOccurrencesWith(store, "u1", MON);
    await editFollowing(store, "u1", occurrenceOn(store, "2026-10-07").id, { title: "Nuevo" }, "gym2");
    expect(store.series.find((s) => s.id === "gym2")?.endsOn).toBe("2026-12-31");
  });

  it("no se puede cortar desde una ocurrencia hecha o salteada", async () => {
    const store = await setup();
    const done = occurrenceOn(store, "2026-10-03");
    done.status = "done";
    expect(await editFollowing(store, "u1", done.id, { title: "x" }, "g2")).toEqual({ ok: false, reason: "not_pending" });
    done.status = "skipped";
    expect(await editFollowing(store, "u1", done.id, { title: "x" }, "g2")).toEqual({ ok: false, reason: "not_pending" });
    expect(store.series).toHaveLength(1);
  });

  it("una ocurrencia ajena o inexistente no se puede editar", async () => {
    const store = await setup();
    const mine = occurrenceOn(store, "2026-10-07");
    expect(await editFollowing(store, "u2", mine.id, { title: "hack" }, "g2")).toEqual({ ok: false, reason: "not_found" });
    expect(await editFollowing(store, "u1", "no-existe", { title: "x" }, "g2")).toEqual({ ok: false, reason: "not_found" });
    expect(store.series).toHaveLength(1);
    expect(store.dates("gym")).toHaveLength(4);
  });
});

describe("borrar", () => {
  it("solo esta: queda como salteada y no reaparece al materializar", async () => {
    const store = new MemoryStore();
    store.series.push(gym());
    await ensureOccurrencesWith(store, "u1", MON);
    const target = store.rows.find((r) => r.date === "2026-10-03")!;

    expect(await deleteOnlyThis(store, "u1", target.id)).toBe(true);
    await ensureOccurrencesWith(store, "u1", MON);

    expect(store.rows.filter((r) => r.date === "2026-10-03")).toHaveLength(1);
    expect(store.rows.find((r) => r.date === "2026-10-03")!.status).toBe("skipped");
  });

  it("solo esta: no borra la de otro usuario", async () => {
    const store = new MemoryStore();
    store.series.push(gym());
    await ensureOccurrencesWith(store, "u1", MON);
    expect(await deleteOnlyThis(store, "u2", store.rows[0].id)).toBe(false);
    expect(store.rows[0].status).toBe("pending");
  });

  it("esta y las siguientes: corta la serie sin crear otra", async () => {
    const store = new MemoryStore();
    store.series.push(gym());
    await ensureOccurrencesWith(store, "u1", MON);
    const target = store.rows.find((r) => r.date === "2026-10-03")!;

    expect(await deleteFollowing(store, "u1", target.id)).toEqual({ ok: true, seriesId: "gym" });
    await ensureOccurrencesWith(store, "u1", MON);

    expect(store.series).toHaveLength(1);
    expect(store.series[0].endsOn).toBe("2026-10-02");
    expect(store.dates("gym")).toEqual(["2026-09-30"]);
  });
});
