import { describe, expect, it } from "vitest";
import {
  findBalancedJson,
  normalizeTaskAction,
  parseTaskActions,
  salvageObjects,
  stripCodeFence,
  stripLeakedTaskJson,
  stripTaskBlock
} from "@/lib/task-actions";

// Milo's `TASKS_ACTION:` block used to be parsed by handing everything after the
// marker to JSON.parse. Any deviation from perfectly-formed JSON lost the entire
// batch with no error logged, which is why recurring requests ("gimnasio los
// miércoles y sábados" -> one task per occurrence) created nothing at all.

const NOW = new Date("2026-09-28T12:00:00.000Z");

describe("findBalancedJson", () => {
  it("returns a complete array", () => {
    expect(findBalancedJson('[{"a":1}]')).toBe('[{"a":1}]');
  });

  it("ignores trailing prose after the block", () => {
    expect(findBalancedJson('[{"a":1}]\n\n¿Te sirvio?')).toBe('[{"a":1}]');
  });

  it("is not confused by brackets inside strings", () => {
    const json = '[{"title":"banco [sucursal]"}]';
    expect(findBalancedJson(`${json} charla`)).toBe(json);
  });

  it("is not confused by escaped quotes", () => {
    const json = '[{"title":"dijo \\"hola\\""}]';
    expect(findBalancedJson(json)).toBe(json);
  });

  it("returns null when the block is truncated", () => {
    expect(findBalancedJson('[{"title":"gimnasio"},{"title":"curs')).toBeNull();
  });
});

describe("stripCodeFence", () => {
  it("removes a json fence", () => {
    expect(stripCodeFence('```json\n[{"a":1}]\n```')).toBe('[{"a":1}]');
  });

  it("leaves unfenced text alone", () => {
    expect(stripCodeFence('[{"a":1}]')).toBe('[{"a":1}]');
  });
});

describe("salvageObjects", () => {
  it("recovers the complete objects from a truncated array", () => {
    const truncated = '[{"title":"Gimnasio","dueDate":"2026-10-07"},{"title":"Clase","dueDat';
    expect(salvageObjects(truncated)).toEqual([{ title: "Gimnasio", dueDate: "2026-10-07" }]);
  });

  it("keeps going past a single broken object", () => {
    const broken = '{bad json}{"title":"Gimnasio"}';
    expect(salvageObjects(broken)).toEqual([{ title: "Gimnasio" }]);
  });
});

describe("normalizeTaskAction", () => {
  it("fills in every optional field the model omitted", () => {
    // The route now asks the model for only title+dueDate to stay under
    // max_tokens, so the rest has to default server-side.
    const result = normalizeTaskAction({ title: "  Gimnasio  ", dueDate: "2026-10-07" }, NOW);
    expect(result).toEqual({
      title: "Gimnasio",
      category: "general",
      description: "",
      priority: "medium",
      estimateMin: 45,
      dueDate: "2026-10-07",
      kind: "task"
    });
  });

  it("rejects an object with no title", () => {
    expect(normalizeTaskAction({ dueDate: "2026-10-07" }, NOW)).toBeNull();
  });

  it("falls back to a week out when the date is malformed", () => {
    const result = normalizeTaskAction({ title: "Banco", dueDate: "martes" }, NOW);
    expect(result?.dueDate).toBe("2026-10-05");
  });

  it("rejects an out-of-range priority instead of trusting the model", () => {
    const result = normalizeTaskAction({ title: "Banco", priority: "urgentisimo" }, NOW);
    expect(result?.priority).toBe("medium");
  });
});

describe("normalizeTaskAction: tipo, hora y repeat", () => {
  it("conserva kind y time cuando son válidos", () => {
    const result = normalizeTaskAction(
      { title: "Llamar al banco", dueDate: "2026-10-01", kind: "reminder", time: "10:30" },
      NOW
    );
    expect(result).toMatchObject({ kind: "reminder", time: "10:30", estimateMin: 5 });
  });

  it("un kind inválido se resuelve con las mismas reglas del formulario", () => {
    const result = normalizeTaskAction(
      { title: "Llamar al banco", dueDate: "2026-10-01", kind: "urgente", time: "10:30" },
      NOW
    );
    expect(result?.kind).toBe("reminder");
    expect(normalizeTaskAction({ title: "Estudiar", dueDate: "2026-10-01", kind: 5 }, NOW)?.kind).toBe("task");
  });

  it("una hora mal escrita se descarta sin perder la tarea", () => {
    for (const time of ["25:00", "9:5", "mañana", 1030, null]) {
      const result = normalizeTaskAction({ title: "Banco", dueDate: "2026-10-01", time }, NOW);
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("time");
    }
  });

  it("usa los minutos del modelo solo si son válidos", () => {
    expect(normalizeTaskAction({ title: "x", estimateMin: 30 }, NOW)?.estimateMin).toBe(30);
    expect(normalizeTaskAction({ title: "x", estimateMin: -5 }, NOW)?.estimateMin).toBe(45);
    expect(normalizeTaskAction({ title: "x", duration: "long" }, NOW)?.estimateMin).toBe(45);
  });

  it("valida y normaliza repeat", () => {
    const result = normalizeTaskAction(
      { title: "Gimnasio", dueDate: "2026-09-30", repeat: { freq: "weekly", weekdays: [6, 3] } },
      NOW
    );
    expect(result?.repeat).toEqual({ freq: "weekly", interval: 1, weekdays: [3, 6] });
  });

  it("un repeat inválido se descarta pero el ítem se conserva", () => {
    for (const repeat of [
      { freq: "cada tanto" },
      { freq: "weekly", weekdays: [3, 9] },
      { freq: "weekly", weekdays: ["miércoles"] },
      { freq: "daily", interval: 0 },
      { freq: "monthly", monthDay: 40 },
      "todos los martes",
      42
    ]) {
      const result = normalizeTaskAction({ title: "Gimnasio", dueDate: "2026-09-30", repeat }, NOW);
      expect(result, JSON.stringify(repeat)).not.toBeNull();
      expect(result?.title).toBe("Gimnasio");
      expect(result).not.toHaveProperty("repeat");
    }
  });

  it("un proyecto no se repite: se descarta el repeat, no el ítem", () => {
    const result = normalizeTaskAction(
      { title: "Tesis", dueDate: "2026-10-01", kind: "project", repeat: { freq: "daily" } },
      NOW
    );
    expect(result?.kind).toBe("project");
    expect(result).not.toHaveProperty("repeat");
  });

  it("un until anterior al inicio se quita, la serie queda", () => {
    const result = normalizeTaskAction(
      { title: "Gym", dueDate: "2026-10-10", repeat: { freq: "daily", until: "2026-10-01" } },
      NOW
    );
    expect(result?.repeat).toEqual({ freq: "daily", interval: 1 });
  });

  it("un mensaje con una recurrencia y otras cosas propone todo, sin expandir", () => {
    const result = parseTaskActions(
      'Dale.\nTASKS_ACTION:[{"title":"Cursar","dueDate":"2026-09-29"},{"title":"Gimnasio","dueDate":"2026-09-30","repeat":{"freq":"weekly","weekdays":[3,6]}}]',
      NOW
    );
    expect(result.taskActions).toHaveLength(2);
    expect(result.taskActions[1].repeat).toEqual({ freq: "weekly", interval: 1, weekdays: [3, 6] });
  });
});

describe("parseTaskActions", () => {
  it("returns nothing when there is no block", () => {
    const result = parseTaskActions("¿Que es un simplex?", NOW);
    expect(result.taskActions).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("parses a well-formed block", () => {
    const result = parseTaskActions(
      'Listo.\nTASKS_ACTION:[{"title":"Gimnasio","dueDate":"2026-10-07"}]',
      NOW
    );
    expect(result.taskActions).toHaveLength(1);
    expect(result.text).toBe("Listo.");
    expect(result.error).toBeNull();
  });

  it("survives the model writing prose after the block", () => {
    const result = parseTaskActions(
      'TASKS_ACTION:[{"title":"Gimnasio","dueDate":"2026-10-07"}]\n\n¿Te sirve?',
      NOW
    );
    expect(result.taskActions).toHaveLength(1);
    expect(result.text).not.toContain("TASKS_ACTION");
  });

  it("survives the model wrapping the block in a code fence", () => {
    const result = parseTaskActions(
      '```json\nTASKS_ACTION:[{"title":"Gimnasio","dueDate":"2026-10-07"}]\n```',
      NOW
    );
    expect(result.taskActions).toHaveLength(1);
  });

  it("survives a trailing period after the block", () => {
    const result = parseTaskActions(
      'TASKS_ACTION:[{"title":"Gimnasio","dueDate":"2026-10-07"}].',
      NOW
    );
    expect(result.taskActions).toHaveLength(1);
  });

  it("accepts a single object that is not wrapped in an array", () => {
    const result = parseTaskActions('TASKS_ACTION:{"title":"Gimnasio","dueDate":"2026-10-07"}', NOW);
    expect(result.taskActions).toHaveLength(1);
  });

  it("recovers the tasks that fit when the reply was cut off by max_tokens", () => {
    // This is the reported bug: a recurring request expands to one task per
    // occurrence, overflows max_tokens, and used to create nothing.
    const truncated =
      'Anotado.\nTASKS_ACTION:[{"title":"Clase","dueDate":"2026-09-29"},{"title":"Gimnasio","dueDate":"2026-10-07"},{"title":"Gimnasio","dueDat';
    const result = parseTaskActions(truncated, NOW);
    expect(result.taskActions.map((t) => t.title)).toEqual(["Clase", "Gimnasio"]);
    expect(result.partial).toBe(true);
  });

  it("never returns more than 12 tasks from one reply", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `Tarea ${i}`, dueDate: "2026-10-07" }));
    const result = parseTaskActions(`TASKS_ACTION:${JSON.stringify(many)}`, NOW);
    expect(result.taskActions).toHaveLength(12);
  });

  it("reports why a block failed instead of failing silently", () => {
    const result = parseTaskActions("TASKS_ACTION:lo hice, no se que", NOW);
    expect(result.taskActions).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe("the reported scenario", () => {
  it("turns 'cursar manana, gimnasio miercoles y sabados' into dated tasks", () => {
    const reply =
      'Dale, te armo las tareas.\nTASKS_ACTION:[{"title":"Ir a cursar","dueDate":"2026-09-29"},{"title":"Gimnasio","dueDate":"2026-10-07"},{"title":"Gimnasio","dueDate":"2026-10-10"}]';
    const result = parseTaskActions(reply, NOW);
    expect(result.taskActions).toHaveLength(3);
    expect(result.taskActions.map((t) => t.dueDate)).toEqual([
      "2026-09-29",
      "2026-10-07",
      "2026-10-10"
    ]);
  });
});

describe("stripLeakedTaskJson", () => {
  it("removes a task array the model duplicated into the prose", () => {
    // Seen in the live eval: the pro model wrote the array once mid-sentence and
    // again after the marker, leaving raw JSON in the chat bubble.
    const reply =
      'He creado recordatorios diarios. [{"title":"Llamar a mi mamá","dueDate":"2026-09-28"},{"title":"Llamar","dueDate":"2026-09-29"}]';
    expect(stripLeakedTaskJson(reply)).not.toContain("title");
    expect(stripLeakedTaskJson(reply)).toContain("He creado recordatorios diarios");
  });

  it("removes a single leaked task object", () => {
    expect(stripLeakedTaskJson('Listo {"title":"Banco","dueDate":"2026-10-01"}')).toBe("Listo");
  });

  it("leaves a reply that merely talks about JSON alone", () => {
    // The user asked about JSON, so we must not eat their example.
    const reply = 'Un objeto se escribe {"clave": "valor"} en JavaScript.';
    expect(stripLeakedTaskJson(reply)).toBe(reply);
  });
});

describe("stripTaskBlock", () => {
  it("removes the block but keeps the reply", () => {
    expect(stripTaskBlock("Hola!\nTASKS_ACTION:[{\"title\":\"X\"}]\nChau")).toBe("Hola!\nChau");
  });

  it("leaves a reply with no block untouched", () => {
    expect(stripTaskBlock("Solo texto")).toBe("Solo texto");
  });

  it("removes a leaked array even when the block parses fine", () => {
    const reply =
      'Listo. [{"title":"Gym","dueDate":"2026-10-07"}]\nTASKS_ACTION:[{"title":"Gym","dueDate":"2026-10-07"}]';
    const result = parseTaskActions(reply, NOW);
    expect(result.taskActions).toHaveLength(1);
    expect(result.text).not.toContain("title");
  });

  it("never shows a half-written block when the reply is cut off", () => {
    // Found in the live eval: a 28-task daily recurrence overflowed max_tokens,
    // and the truncated `{"title":"L` was rendered in the chat bubble because the
    // unbalanced tail used to be treated as prose.
    const truncated =
      'Te propongo estas tareas para los próximos 28 días.  \nTASKS_ACTION:[{"title":"Llamar a mamá","dueDate":"2026-09-28"},{"title":"L';
    const result = parseTaskActions(truncated, NOW);
    expect(result.text).not.toContain("title");
    expect(result.text).not.toContain("TASKS_ACTION");
    expect(result.text).toBe("Te propongo estas tareas para los próximos 28 días.");
  });

  it("keeps plain prose that follows an unusable block", () => {
    const result = parseTaskActions("Dale.\nTASKS_ACTION:no, no hace falta", NOW);
    expect(result.text).toBe("Dale.\nno, no hace falta");
  });
});
