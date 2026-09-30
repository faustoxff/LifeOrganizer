import { describe, expect, it } from "vitest";
import { buildTaskContext, buildTaskPromptParts } from "@/lib/milo-chat-prompt";
import { getZonedNow } from "@/lib/task-date";
import type { Task } from "@/types/task";

/**
 * The prompt is split into a cacheable half and a per-turn half so a paid
 * provider can reuse the rules instead of re-charging them on every message.
 *
 * That only pays off if the static half really is stable. If a date, a task
 * title or a user's memory leaks into it, the cache misses on every turn and
 * the split is decoration. These tests hold that line.
 */

const NOW = new Date("2026-03-11T14:30:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Llamar al banco",
    description: "",
    category: "personal",
    priority: "medium",
    dueDate: "2026-03-12",
    estimateMin: 45,
    kind: "task",
    status: "pending",
    done: false,
    ...overrides
  };
}

describe("buildTaskPromptParts: the static half", () => {
  it("is byte-identical across users, tasks and turns", () => {
    // The whole saving depends on this. A leak of any per-turn detail here
    // would silently cost the full prompt price on every message.
    const a = buildTaskPromptParts({ canCreateTasks: true, now: NOW });
    const b = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: [task({ title: "Cosa totalmente distinta" })],
      userMemory: "trabaja de noche, pospone todo",
      pendingTaskAction: { title: "Otra", category: "work" } as never,
      now: NOW
    });

    expect(a.static).toBe(b.static);
  });

  it("changes across days only in the one date the example needs", () => {
    // A deliberate trade-off, pinned so nobody "fixes" it by accident.
    //
    // The example inside the rules shows a real date rather than a
    // `YYYY-MM-DD` placeholder, because a literal placeholder invites the model
    // to emit it verbatim as a dueDate and create garbage tasks. The cost is one
    // cache re-warm per day per plan variant — the rules are ~700 tokens and the
    // cached-vs-fresh gap is $0.136/M, so that re-warm is worth pennies.
    //
    // The important part is that nothing ELSE moves. If a second date or any
    // other per-turn detail ever lands in here, the cache starts missing on
    // every request and the split becomes decoration.
    const today = buildTaskPromptParts({ canCreateTasks: true, now: NOW }).static;
    const tomorrow = buildTaskPromptParts({
      canCreateTasks: true,
      now: new Date("2026-03-12T09:00:00.000Z")
    }).static;

    const datesIn = (text: string) => text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    expect(datesIn(today)).toEqual(["2026-03-18", "2026-03-18"]);
    expect(datesIn(tomorrow)).toEqual(["2026-03-19", "2026-03-19"]);

    // Everything but those two dates is identical, character for character.
    expect(today.replace(/2026-03-18/g, "DATE")).toBe(tomorrow.replace(/2026-03-19/g, "DATE"));
  });

  it("carries no task title or user detail", () => {
    const { static: staticPart } = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: [task({ title: "Llamar al banco" })],
      userMemory: "miedo a llamar por teléfono",
      now: NOW
    });

    expect(staticPart).not.toContain("Llamar al banco");
    expect(staticPart).not.toContain("miedo a llamar");
  });

  it("differs between a user who can create tasks and one who cannot", () => {
    // Two variants, both of which stay hot, so this is not a cache-hostile
    // branch. What must never happen is the paid variant leaking to the Free
    // user and offering buttons that will not work.
    const paid = buildTaskPromptParts({ canCreateTasks: true, now: NOW }).static;
    const free = buildTaskPromptParts({ canCreateTasks: false, now: NOW }).static;

    expect(paid).not.toBe(free);
    expect(paid).toContain("TASKS_ACTION");
    expect(free).not.toContain("TASKS_ACTION:[{");
    expect(free).toContain("plan Free");
  });
});

describe("buildTaskPromptParts: the dynamic half", () => {
  it("changes with the date, so the model always sees today", () => {
    const monday = buildTaskPromptParts({ canCreateTasks: true, now: NOW }).dynamic;
    const tuesday = buildTaskPromptParts({
      canCreateTasks: true,
      now: new Date("2026-03-12T09:00:00.000Z")
    }).dynamic;

    expect(monday).toContain("2026-03-11");
    expect(tuesday).toContain("2026-03-12");
  });

  it("resolves the relative dates the model is told to use", () => {
    const { dynamic } = buildTaskPromptParts({ canCreateTasks: true, now: NOW });

    expect(dynamic).toContain("\"hoy\" = 2026-03-11");
    expect(dynamic).toContain("\"mañana\" = 2026-03-12");
    expect(dynamic).toContain("\"pasado mañana\" = 2026-03-13");
  });

  it("lists the user's tasks and memory", () => {
    const { dynamic } = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: [task({ title: "Llamar al banco" })],
      userMemory: "prefiere las mañanas",
      now: NOW
    });

    expect(dynamic).toContain("Llamar al banco");
    expect(dynamic).toContain("prefiere las mañanas");
  });

  it("carries the default date for a task with none", () => {
    const { dynamic } = buildTaskPromptParts({ canCreateTasks: true, now: NOW });

    // Seven days out. This is what stops the model from asking "¿para qué día?".
    expect(dynamic).toContain("2026-03-18");
  });
});

describe("buildTaskPromptParts: the pending list is bounded", () => {
  const many = (n: number, over: Partial<Task> = {}) =>
    Array.from({ length: n }, (_, i) =>
      task({ id: `t${i}`, title: `Tarea ${i}`, dueDate: "2026-03-20", ...over })
    );

  it("shows every pending task when the list is short", () => {
    const { dynamic } = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: many(25),
      now: NOW
    });

    for (let i = 0; i < 25; i++) expect(dynamic).toContain(`Tarea ${i}`);
    expect(dynamic).not.toContain("por brevedad");
  });

  it("caps a long list instead of sending all of it", () => {
    // The completed list was capped at 15 and the pending one was not, so a
    // user with a lot of open tasks sent 5632 tokens of prompt — and got a
    // model that answers the pile instead of answering them.
    const { dynamic } = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: many(200),
      now: NOW
    });

    expect(dynamic).toContain("Tarea 0");
    expect(dynamic).not.toContain("Tarea 199");
    expect(dynamic).toContain("175 pendiente(s) más");
  });

  it("keeps the most urgent and drops the least", () => {
    // Truncating by array order would quietly hide the one task that is late,
    // which is the only one the user actually needs to hear about.
    const { dynamic } = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: [
        ...many(30, { priority: "low", dueDate: "2026-04-30" }),
        task({ id: "urgent", title: "Vencida importante", priority: "high", dueDate: "2026-03-01" })
      ],
      now: NOW
    });

    // 1 slot goes to the high-priority task, 24 to the 30 low-priority ones.
    expect(dynamic).toContain("Vencida importante");
    expect(dynamic).toContain("Tarea 23");
    expect(dynamic).not.toContain("Tarea 29");
    expect(dynamic).toContain("6 pendiente(s) más");
  });

  it("tells the model the list is incomplete so it cannot claim otherwise", () => {
    // Without this line the model reads 25 lines, believes that is all the user
    // has, and confidently says "tenés 12 tareas" when they have 200.
    const { dynamic } = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: many(40),
      now: NOW
    });

    expect(dynamic).toContain("15 pendiente(s) más");
    expect(dynamic).toMatch(/no están en esta lista/);
    expect(dynamic).toMatch(/no existe/);
  });
});

describe("buildTaskContext: the joined form", () => {
  it("preserves the order that makes the cache work", () => {
    // Static first, dynamic second. A per-turn segment in front of the rules
    // would invalidate all of them on every single request.
    const options = { canCreateTasks: true, now: NOW };
    const { static: staticPart, dynamic } = buildTaskPromptParts(options);
    const joined = buildTaskContext(options);

    expect(joined).toBe(`${staticPart}\n${dynamic}`);
    expect(joined.indexOf("Estilo:")).toBeLessThan(joined.indexOf("Fecha de hoy:"));
  });

  it("still contains everything the model needs", () => {
    // The eval harness and any other caller using the single-string form must
    // get the same prompt the chat route sends, not a subset.
    const joined = buildTaskContext({
      canCreateTasks: true,
      tasks: [task()],
      userMemory: "algo",
      now: NOW
    });

    expect(joined).toContain("Voseo rioplatense");
    expect(joined).toContain("TASKS_ACTION");
    expect(joined).toContain("Fecha de hoy: 2026-03-11");
    expect(joined).toContain("Llamar al banco");
  });
});

describe("buildTaskPromptParts: recurrencias", () => {
  const paid = () => buildTaskPromptParts({ canCreateTasks: true, now: NOW }).static;

  it("le pide UNA tarea con repeat y ya no una por ocurrencia", () => {
    const rules = paid();
    expect(rules).toContain('"repeat"');
    expect(rules).toContain("UN solo objeto");
    expect(rules).toMatch(/NUNCA un objeto por cada vez/);
    // La instrucción vieja, que fabricaba hasta 12 tareas por recurrencia.
    expect(rules).not.toMatch(/una tarea por ocurrencia/i);
    expect(rules).not.toMatch(/hasta 12\b/);
    expect(rules).not.toMatch(/-> 8 tareas/);
  });

  it("explica los campos nuevos y la convención de weekdays", () => {
    const rules = paid();
    expect(rules).toContain('"kind"');
    expect(rules).toContain('"time"');
    expect(rules).toContain("0=domingo");
    expect(rules).toMatch(/monthDay/);
  });

  it("trae los ejemplos que fijan el comportamiento", () => {
    const rules = paid();
    expect(rules).toContain('gimnasio los miércoles y sábados" -> 1 tarea');
    expect(rules).toContain('"weekdays":[3,6]');
    expect(rules).toContain('"repeat" daily');
    expect(rules).toContain('"monthDay":5');
  });

  it("mantiene que se incluyan TODOS los ítems del mensaje", () => {
    expect(paid()).toMatch(/incluí TODAS/);
  });

  it("el usuario Free no recibe nada de esto", () => {
    const free = buildTaskPromptParts({ canCreateTasks: false, now: NOW }).static;
    expect(free).not.toContain('"repeat"');
    expect(free).not.toContain("TASKS_ACTION:[{");
  });

  it("sigue siendo idéntico entre usuarios: los ejemplos nuevos no filtran nada por usuario", () => {
    const a = buildTaskPromptParts({ canCreateTasks: true, now: NOW });
    const b = buildTaskPromptParts({ canCreateTasks: true, tasks: [task({ title: "Otra" })], userMemory: "x", now: NOW });
    expect(a.static).toBe(b.static);
  });
});

describe("buildTaskPromptParts: tipo, hora y minutos en la lista", () => {
  it("muestra los minutos, no las categorías corta/media/larga", () => {
    const { dynamic } = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: [task({ estimateMin: 90 })],
      now: NOW
    });
    expect(dynamic).toContain("duración: 90 min");
    expect(dynamic).not.toMatch(/duración: (short|medium|long)/);
  });

  it("marca recordatorios, proyectos, horas y series", () => {
    const { dynamic } = buildTaskPromptParts({
      canCreateTasks: true,
      tasks: [
        task({ id: "a", title: "Pagar luz", kind: "reminder", time: "09:30" }),
        task({ id: "b", title: "Tesis", kind: "project" }),
        task({ id: "c", title: "Gimnasio", seriesId: "s1" })
      ],
      now: NOW
    });
    expect(dynamic).toMatch(/Pagar luz.*a las 09:30.*recordatorio/);
    expect(dynamic).toMatch(/Tesis.*proyecto/);
    expect(dynamic).toMatch(/Gimnasio.*se repite/);
  });
});

describe("buildTaskPromptParts: hoy en la zona del usuario", () => {
  // 01:30 UTC del martes 29: en Buenos Aires todavía es la noche del lunes 28.
  const INSTANT = new Date("2026-09-29T01:30:00.000Z");

  it("con la hora de pared del usuario, hoy es el día del usuario y no el de UTC", () => {
    const now = getZonedNow("America/Argentina/Buenos_Aires", INSTANT);
    const { dynamic } = buildTaskPromptParts({ canCreateTasks: true, now });
    expect(dynamic).toContain('"hoy" = 2026-09-28');
    expect(dynamic).toContain('"mañana" = 2026-09-29');
    // 2026-09-28 es lunes: la fila del lunes arranca en esa fecha.
    expect(dynamic).toContain("- lunes: 2026-09-28, 2026-10-05, 2026-10-12");
  });

  it("el mismo instante en UTC da el día siguiente", () => {
    const { dynamic } = buildTaskPromptParts({ canCreateTasks: true, now: INSTANT });
    expect(dynamic).toContain('"hoy" = 2026-09-29');
  });

  it("no depende de la zona del proceso: las fechas se arman con getters UTC", () => {
    const original = process.env.TZ;
    try {
      const outputs = ["UTC", "America/Argentina/Buenos_Aires", "Asia/Tokyo"].map((tz) => {
        process.env.TZ = tz;
        return buildTaskPromptParts({ canCreateTasks: true, now: NOW }).dynamic;
      });
      expect(new Set(outputs).size).toBe(1);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
