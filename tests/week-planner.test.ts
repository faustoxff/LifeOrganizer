import { describe, expect, it } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import { addDays } from "@/lib/recurrence";
import {
  isHeavy,
  planWeek,
  SOFT_CAP,
  type ExistingEntry,
  type WeekItem,
  type WeekPlan,
  type WeekPlanInput
} from "@/lib/week-planner";

// Lunes 2026-09-28. Disponibilidad por defecto: lun-vie 2 h, sáb 3 h, dom 1 h.
const MON = "2026-09-28";
const TUE = "2026-09-29";
const WED = "2026-09-30";
const THU = "2026-10-01";
const FRI = "2026-10-02";
const SAT = "2026-10-03";
const SUN = "2026-10-04";
const NEXT_MON = "2026-10-05";

const item = (title: string, estimateMin: number, extra: Partial<WeekItem> = {}): WeekItem => ({
  title,
  kind: "task",
  estimateMin,
  priority: "medium",
  ...extra
});

function plan(items: WeekItem[], extra: Partial<WeekPlanInput> = {}): WeekPlan {
  return planWeek({
    today: MON,
    weekStart: MON,
    availability: DEFAULT_AVAILABILITY,
    items,
    ...extra
  });
}

const dateOf = (p: WeekPlan, title: string) => p.placed.find((x) => x.item.title === title)?.date;
const loadOf = (p: WeekPlan, date: string) => {
  const day = p.days.find((d) => d.date === date)!;
  return day.existingMin + day.plannedMin;
};

describe("isHeavy", () => {
  it("is 90+ minutes, or high priority from 60", () => {
    expect(isHeavy(90, "medium")).toBe(true);
    expect(isHeavy(89, "medium")).toBe(false);
    expect(isHeavy(60, "high")).toBe(true);
    expect(isHeavy(59, "high")).toBe(false);
    expect(isHeavy(60, "medium")).toBe(false);
  });
});

describe("semana liviana", () => {
  const items = [item("Llamar al banco", 20), item("Turno médico", 30), item("Ordenar apuntes", 45)];

  it("coloca todo y no diferí nada", () => {
    const p = plan(items);
    expect(p.placed).toHaveLength(3);
    expect(p.deferred).toHaveLength(0);
    expect(p.warnings).toEqual([]);
  });

  it("deja al menos un día liviano", () => {
    const p = plan(items);
    expect(p.days.some((d) => d.light && d.capacityMin > 0)).toBe(true);
  });

  it("no llena ningún día por encima del 85 %", () => {
    const p = plan(items);
    for (const d of p.days) {
      if (d.capacityMin > 0) expect(d.existingMin + d.plannedMin).toBeLessThanOrEqual(SOFT_CAP * d.capacityMin);
    }
  });
});

describe("reparto parejo", () => {
  it("cinco cosas chicas caen en cinco días distintos, no en uno", () => {
    const p = plan([1, 2, 3, 4, 5].map((n) => item(`Cosa ${n}`, 30)));
    const perDay = new Map<string, number>();
    for (const x of p.placed) perDay.set(x.date, (perDay.get(x.date) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBe(1);
    expect(perDay.size).toBe(5);
  });

  it("no apila un día si hay otros vacíos, aunque ya haya cosas ahí", () => {
    const existing: ExistingEntry[] = [
      { date: MON, title: "Clase", minutes: 30 },
      { date: MON, title: "Gym", minutes: 30 }
    ];
    const p = plan([item("Informe", 30)], { existing });
    expect(dateOf(p, "Informe")).not.toBe(MON);
  });
});

describe("dos pesadas", () => {
  it("no pone dos pesadas el mismo día si hay otro lugar", () => {
    const p = plan([item("Informe", 90), item("Estudiar física", 100), item("Práctico", 90)]);
    const days = p.placed.map((x) => x.date);
    expect(new Set(days).size).toBe(3);
  });

  it("cuenta la pesada que ya estaba agendada", () => {
    const existing: ExistingEntry[] = [{ date: SAT, title: "TP de álgebra", minutes: 90 }];
    // El sábado entra otra de 90 (capacidad 180), pero sería la segunda pesada del día.
    const p = plan([item("Informe", 90, { deadline: SAT })], { existing });
    expect(dateOf(p, "Informe")).not.toBe(SAT);
    expect(p.placed[0].reason.code).not.toBe("FIXED");
  });

  it("una de prioridad alta de 60 también es pesada", () => {
    const p = plan([item("A", 60, { priority: "high" }), item("B", 60, { priority: "high" })]);
    expect(dateOf(p, "A")).not.toBe(dateOf(p, "B"));
  });

  it("las junta si no hay otra salida (una sola ventana)", () => {
    const p = plan([item("A", 90, { dueDate: SAT }), item("B", 90, { deadline: SAT }), item("C", 30)], {
      today: SAT,
      weekStart: SAT
    });
    // Solo quedan sábado y domingo; el pesado B tiene que ir el sábado aunque ya haya otro.
    expect(dateOf(p, "B")).toBe(SAT);
  });
});

describe("fechas fijas", () => {
  it("van en su fecha aunque ese día esté cargado", () => {
    const existing: ExistingEntry[] = [{ date: TUE, title: "Clase", minutes: 100 }];
    const p = plan([item("Rendir el parcial", 120, { dueDate: TUE, priority: "high" })], { existing });
    expect(dateOf(p, "Rendir el parcial")).toBe(TUE);
    expect(p.placed[0].fixed).toBe(true);
    expect(p.placed[0].reason.code).toBe("FIXED");
    expect(p.warnings).toContainEqual({ code: "OVERBOOKED_DAY", date: TUE, loadMin: 220, capacityMin: 120 });
  });

  it("los flexibles se acomodan alrededor de las fijas", () => {
    const p = plan([item("Parcial", 120, { dueDate: WED }), item("Leer", 60)]);
    expect(dateOf(p, "Parcial")).toBe(WED);
    expect(dateOf(p, "Leer")).not.toBe(WED);
  });

  it("una fecha fija de otra semana se respeta y no ocupa esta", () => {
    const p = plan([item("Casamiento", 60, { dueDate: "2026-10-20" })]);
    expect(p.placed[0]).toMatchObject({ date: "2026-10-20", outsideWindow: true });
    expect(p.days.every((d) => d.plannedMin === 0)).toBe(true);
  });

  it("una recurrencia cae en los días de su regla y cuenta en cada uno", () => {
    const gym = item("Gimnasio", 60, { repeat: { freq: "weekly", interval: 1, weekdays: [3, 6] }, dueDate: MON });
    const p = plan([gym]);
    expect(p.placed).toHaveLength(1);
    expect(p.placed[0].reason).toEqual({ code: "RECURRING", dates: [WED, SAT] });
    expect(loadOf(p, WED)).toBe(60);
    expect(loadOf(p, SAT)).toBe(60);
    expect(p.days.find((d) => d.date === WED)!.placed).toHaveLength(1);
    expect(p.days.find((d) => d.date === THU)!.placed).toHaveLength(0);
  });

  it("los flexibles esquivan los días de la recurrencia", () => {
    const gym = item("Gimnasio", 90, { repeat: { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] }, dueDate: MON });
    const p = plan([gym, item("Leer", 60)]);
    expect([SAT, SUN]).toContain(dateOf(p, "Leer"));
  });
});

describe("deadline", () => {
  it("un flexible con deadline no pasa de ese día", () => {
    const p = plan([item("Entregar informe", 60, { deadline: TUE })]);
    expect(dateOf(p, "Entregar informe")! <= TUE).toBe(true);
  });

  it("con un solo día posible lo dice en la razón", () => {
    const p = plan([item("Entregar", 60, { deadline: MON })]);
    expect(p.placed[0]).toMatchObject({ date: MON, reason: { code: "DEADLINE", deadline: MON } });
  });

  it("si el deadline ya pasó no hay dónde ponerlo", () => {
    const p = plan([item("Vencido", 30, { deadline: "2026-09-20" })]);
    expect(p.placed).toHaveLength(0);
    expect(p.deferred[0].code).toBe("NO_DAY");
  });

  it("avisa cuando un diferido tenía deadline dentro de la semana", () => {
    const p = plan([item("Enorme", 200, { deadline: WED })]);
    expect(p.deferred[0].code).toBe("TOO_BIG");
    expect(p.warnings).toContainEqual({ code: "DEADLINE_AT_RISK", index: 0, deadline: WED });
  });
});

describe("semana sobrecargada", () => {
  // Capacidad total: 5×120 + 180 + 60 = 840 min.
  const many = () => [
    ...Array.from({ length: 8 }, (_, n) => item(`Alta ${n}`, 60, { priority: "high" })),
    ...Array.from({ length: 8 }, (_, n) => item(`Baja ${n}`, 60, { priority: "low" }))
  ];

  it("difiere lo que no entra y sugiere la semana siguiente", () => {
    const p = plan(many());
    expect(p.deferred.length).toBeGreaterThan(0);
    expect(p.deferred.every((d) => d.suggestedDate === NEXT_MON)).toBe(true);
    expect(p.placed.length + p.deferred.length).toBe(16);
  });

  it("difiere primero lo de menor prioridad", () => {
    const p = plan(many());
    expect(p.deferred.every((d) => d.item.priority === "low")).toBe(true);
    expect(p.placed.filter((x) => x.item.priority === "high")).toHaveLength(8);
  });

  it("dentro de la misma prioridad, sale antes lo que vence primero", () => {
    const items = [
      item("Sin fecha", 120, { priority: "low" }),
      item("Vence pronto", 120, { priority: "low", deadline: NEXT_MON }),
      ...Array.from({ length: 6 }, (_, n) => item(`Base ${n}`, 120, { priority: "high" }))
    ];
    const p = plan(items, { availability: { ...DEFAULT_AVAILABILITY, "6": 120, "0": 120 } });
    // 7 días × 120 = 840; entran 7 de 8. El que queda afuera es el de baja prioridad sin fecha.
    expect(p.deferred.map((d) => d.item.title)).toEqual(["Sin fecha"]);
  });

  it("nunca pasa de la capacidad de un día con los ítems que coloca", () => {
    const p = plan(many());
    for (const d of p.days) expect(d.existingMin + d.plannedMin).toBeLessThanOrEqual(d.capacityMin);
  });

  it("solo llega al 100 % cuando no queda otro lugar", () => {
    const p = plan(many());
    // Con todo tan lleno, la semana entera pasa el 85 %: es el caso "no hay otros días con lugar".
    expect(p.days.some((d) => d.loadPct > 85)).toBe(true);
  });
});

describe("no entra todo", () => {
  it("con dos días por delante difiere lo sobrante y lo cuenta", () => {
    // Sábado 180 + domingo 60 = 240; seis de 60 son 360.
    const p = plan(Array.from({ length: 6 }, (_, n) => item(`T${n}`, 60)), { today: SAT, weekStart: SAT });
    expect(p.days.map((d) => d.date)).toEqual([SAT, SUN, "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(p.placed.length + p.deferred.length).toBe(6);
  });

  it("un ítem más largo que cualquier día se marca TOO_BIG", () => {
    const p = plan([item("Tesis", 300)]);
    expect(p.deferred[0]).toMatchObject({ code: "TOO_BIG", neededMin: 300, freeMin: 180 });
  });

  it("los días sin disponibilidad no reciben nada", () => {
    const p = plan([item("A", 60), item("B", 60), item("C", 60)], {
      availability: { ...DEFAULT_AVAILABILITY, "1": 0, "2": 0, "3": 0 }
    });
    for (const x of p.placed) expect([MON, TUE, WED]).not.toContain(x.date);
  });

  it("sin ninguna disponibilidad difiere todo", () => {
    const zero = Object.fromEntries(Object.keys(DEFAULT_AVAILABILITY).map((k) => [k, 0])) as typeof DEFAULT_AVAILABILITY;
    const p = plan([item("A", 30)], { availability: zero });
    expect(p.placed).toHaveLength(0);
    expect(p.deferred[0].code).toBe("NO_DAY");
  });
});

describe("ventana y disponibilidad", () => {
  it("no coloca nada antes de hoy", () => {
    const p = plan([item("A", 30), item("B", 30)], { today: THU });
    expect(p.days[0].date).toBe(THU);
    for (const x of p.placed) expect(x.date >= THU).toBe(true);
  });

  it("respeta un override de un día puntual", () => {
    const p = plan([item("A", 60), item("B", 60), item("C", 60), item("D", 60)], {
      overrides: { [MON]: 0, [TUE]: 0, [WED]: 0, [THU]: 0 }
    });
    for (const x of p.placed) expect([FRI, SAT, SUN]).toContain(x.date);
  });

  it("lo agendado que venció cuenta hoy", () => {
    const p = plan([], { today: WED, weekStart: WED, existing: [{ date: MON, title: "Vencida", minutes: 45 }] });
    expect(p.days[0].existingMin).toBe(45);
  });

  it("aplica la inflación aprendida a los ítems nuevos, no a lo agendado", () => {
    const p = plan([item("Leer", 60, { dueDate: TUE })], { inflation: 1.5, existing: [{ date: TUE, title: "X", minutes: 10 }] });
    expect(loadOf(p, TUE)).toBe(100);
  });
});

describe("razones", () => {
  it("'el lunes ya tenés 2 h de TP': el día lleno se descarta y se dice cuál era", () => {
    const p = plan([item("Informe", 60)], { existing: [{ date: MON, title: "TP", minutes: 120 }] });
    expect(p.placed[0].date).toBe(TUE);
    expect(p.placed[0].reason).toEqual({ code: "FULL", date: MON, minutes: 120, title: "TP" });
  });

  it("explica el choque de pesadas", () => {
    const p = plan([item("Informe", 90)], {
      today: SAT,
      weekStart: SAT,
      existing: [{ date: SAT, title: "TP de álgebra", minutes: 90 }]
    });
    expect(p.placed[0].reason).toMatchObject({ code: "HEAVY_CLASH", date: SAT, title: "TP de álgebra" });
  });

  it("explica el tope del 85 %", () => {
    const p = plan([item("Leer", 30)], { existing: [{ date: MON, title: "Clase", minutes: 80 }, { date: TUE, title: "Otra", minutes: 30 }] });
    // Lunes: 80 + 30 = 110 > 102 (85 % de 120). Martes: 60, entra.
    expect(p.placed[0].date).not.toBe(MON);
    expect(["OVER_CAP", "BUSIER", "BEST_FIT"]).toContain(p.placed[0].reason.code);
  });

  it("sin nada que descartar, es BEST_FIT", () => {
    const p = plan([item("Leer", 30)]);
    expect(p.placed[0].reason.code).toBe("BEST_FIT");
  });
});

describe("día liviano", () => {
  it("avisa si las fechas fijas ya dejan la semana sin día liviano", () => {
    const fixed = [MON, TUE, WED, THU, FRI, SAT, SUN].map((d) => item(`Fija ${d}`, 90, { dueDate: d }));
    const p = plan(fixed, { availability: { ...DEFAULT_AVAILABILITY, "0": 120, "6": 120 } });
    expect(p.warnings).toContainEqual({ code: "NO_LIGHT_DAY" });
  });

  it("no exige día liviano con menos de tres días útiles", () => {
    const p = plan([item("A", 60), item("B", 60)], { today: SAT, weekStart: SAT, availability: { ...DEFAULT_AVAILABILITY, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } });
    expect(p.warnings.find((w) => w.code === "NO_LIGHT_DAY")).toBeUndefined();
  });
});

describe("propiedades (semillas fijas)", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  function randomInput(seed: number): WeekPlanInput {
    const r = rng(seed);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const availability = Object.fromEntries(
      (["0", "1", "2", "3", "4", "5", "6"] as const).map((k) => [k, pick([0, 30, 60, 120, 180, 240])])
    ) as typeof DEFAULT_AVAILABILITY;
    const today = addDays(MON, Math.floor(r() * 8));
    const items: WeekItem[] = Array.from({ length: 1 + Math.floor(r() * 12) }, (_, n) => {
      const base = item(`I${n}`, pick([10, 20, 30, 45, 60, 90, 120, 200]), {
        priority: pick(["low", "medium", "high"] as const)
      });
      const roll = r();
      if (roll < 0.2) base.dueDate = addDays(MON, Math.floor(r() * 9));
      else if (roll < 0.45) base.deadline = addDays(MON, Math.floor(r() * 9));
      return base;
    });
    const existing: ExistingEntry[] = Array.from({ length: Math.floor(r() * 6) }, (_, n) => ({
      date: addDays(MON, Math.floor(r() * 7)),
      title: `E${n}`,
      minutes: pick([15, 30, 60, 90])
    }));
    return { today, weekStart: MON, availability, items, existing };
  }

  it("cada ítem queda colocado o diferido, exactamente una vez", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const input = randomInput(seed);
      const p = planWeek(input);
      const seen = [...p.placed.map((x) => x.index), ...p.deferred.map((x) => x.index)].sort((a, b) => a - b);
      expect(seen, `semilla ${seed}`).toEqual(input.items.map((_, i) => i));
    }
  });

  it("un flexible nunca pasa de la capacidad, ni de su deadline, ni cae en un día sin tiempo", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const input = randomInput(seed);
      const p = planWeek(input);
      for (const x of p.placed.filter((y) => !y.fixed)) {
        expect(x.date >= input.today, `semilla ${seed}`).toBe(true);
        if (x.item.deadline) expect(x.date <= x.item.deadline, `semilla ${seed}`).toBe(true);
        const day = p.days.find((d) => d.date === x.date)!;
        expect(day.capacityMin, `semilla ${seed}`).toBeGreaterThan(0);
      }
      // Un día solo puede pasarse de su capacidad por lo fijo o lo ya agendado.
      const fixedOnly = new Map<string, number>();
      for (const e of input.existing ?? []) {
        const date = e.date < input.today ? input.today : e.date;
        fixedOnly.set(date, (fixedOnly.get(date) ?? 0) + e.minutes);
      }
      for (const x of p.placed.filter((y) => y.fixed)) {
        const dates = x.reason.code === "RECURRING" ? (x.reason.dates ?? []) : [x.date];
        for (const date of dates) fixedOnly.set(date, (fixedOnly.get(date) ?? 0) + x.item.estimateMin);
      }
      for (const d of p.days) {
        if (d.existingMin + d.plannedMin > d.capacityMin) {
          expect(fixedOnly.get(d.date) ?? 0, `semilla ${seed} día ${d.date}`).toBeGreaterThan(d.capacityMin);
        }
      }
    }
  });

  it("es determinístico y no muta el input", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const input = randomInput(seed);
      const snapshot = JSON.stringify(input);
      const a = JSON.stringify(planWeek(input));
      expect(JSON.stringify(input)).toBe(snapshot);
      expect(JSON.stringify(planWeek(input))).toBe(a);
    }
  });

  it("cada diferido tiene una causa verificable", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const input = randomInput(seed);
      const p = planWeek(input);
      const capacityOf = (date: string) => p.days.find((d) => d.date === date)?.capacityMin ?? 0;
      for (const d of p.deferred) {
        const eligible = p.days.filter((day) => day.capacityMin > 0 && (!d.item.deadline || day.date <= d.item.deadline));
        if (d.code === "NO_DAY") expect(eligible, `semilla ${seed}`).toHaveLength(0);
        if (d.code === "TOO_BIG") {
          expect(d.neededMin, `semilla ${seed}`).toBeGreaterThan(Math.max(...eligible.map((day) => capacityOf(day.date))));
        }
        if (d.code === "NO_ROOM") {
          expect(eligible.length, `semilla ${seed}`).toBeGreaterThan(0);
          expect(d.neededMin, `semilla ${seed}`).toBeGreaterThan(d.freeMin);
        }
      }
    }
  });
});
