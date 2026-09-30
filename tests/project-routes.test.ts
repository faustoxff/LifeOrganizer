import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";

// Every dependency that touches the network or the database is replaced: what is under
// test here is the gate (auth, plan, daily limit, validation) around the AI and the
// service, not the AI or the SQL, which have their own tests.
const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getUserPlan: vi.fn(),
  consumeDailyUsage: vi.fn(),
  runIntake: vi.fn(),
  runPlan: vi.fn(),
  summarizeText: vi.fn(),
  previewDraft: vi.fn(),
  createFromDraft: vi.fn(),
  listProjects: vi.fn(),
  moveDeadline: vi.fn(),
  addDailyMinutes: vi.fn(),
  applySubtaskAction: vi.fn(),
  countUserTasks: vi.fn()
}));

vi.mock("@/lib/db", () => ({ default: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ requireAuth: mocks.requireAuth, getUserPlan: mocks.getUserPlan }));
vi.mock("@/lib/usage-limits", async (original) => ({
  ...(await original<typeof import("@/lib/usage-limits")>()),
  consumeDailyUsage: mocks.consumeDailyUsage
}));
vi.mock("@/lib/project-ai", async (original) => ({
  ...(await original<typeof import("@/lib/project-ai")>()),
  runIntake: mocks.runIntake,
  runPlan: mocks.runPlan,
  summarizeText: mocks.summarizeText
}));
vi.mock("@/lib/projects-service", async (original) => ({
  ...(await original<typeof import("@/lib/projects-service")>()),
  previewDraft: mocks.previewDraft,
  createFromDraft: mocks.createFromDraft,
  listProjects: mocks.listProjects,
  moveDeadline: mocks.moveDeadline,
  addDailyMinutes: mocks.addDailyMinutes,
  applySubtaskAction: mocks.applySubtaskAction
}));
vi.mock("@/lib/storage", () => ({ countUserTasks: mocks.countUserTasks }));
vi.mock("@/lib/user-settings", () => ({
  resolveUserTimeZone: async () => "UTC",
  getAvailabilitySettings: async () => ({ availability: DEFAULT_AVAILABILITY, overrides: {}, configured: true })
}));

import { POST as intake } from "@/app/api/projects/intake/route";
import { POST as plan } from "@/app/api/projects/plan/route";
import { POST as preview } from "@/app/api/projects/preview/route";
import { POST as extract } from "@/app/api/projects/extract/route";
import { GET as list, POST as create, PATCH as patchProjects } from "@/app/api/projects/route";
import { PATCH as patchSubtask } from "@/app/api/projects/subtasks/route";
import { ProjectAiError } from "@/lib/project-ai";
import { DAILY_LIMITS } from "@/lib/usage-limits";

const future = () => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const req = (path: string, body?: unknown, method = "POST") =>
  new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
const basics = () => ({ title: "TP de álgebra", description: "Entregar el TP", deadline: future() });
const subtasks = () => [{ tempId: "t1", title: "Leer la consigna", estimateMin: 20, dependsOn: [], deliverable: false }];
const draftPlan = () => ({ subtasks: subtasks(), sessions: [], plan: { feasible: true }, warnings: [], inflation: 1.3 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue("u1");
  mocks.getUserPlan.mockResolvedValue("plus");
  mocks.consumeDailyUsage.mockResolvedValue({ allowed: true, limit: 15 });
  mocks.runIntake.mockResolvedValue({ understanding: "Entendí un TP individual de álgebra.", questions: [] });
  mocks.runPlan.mockResolvedValue({ subtasks: subtasks(), warnings: [] });
  mocks.previewDraft.mockResolvedValue(draftPlan());
  mocks.createFromDraft.mockResolvedValue([{ task: { id: "p1" } }]);
  mocks.listProjects.mockResolvedValue([]);
  mocks.countUserTasks.mockResolvedValue(3);
});

describe("límites de uso por plan", () => {
  it("los kinds de proyecto no existen en Free y crecen con el plan", () => {
    for (const kind of ["project_intake", "project_plan"] as const) {
      expect(DAILY_LIMITS[kind].free).toBe(0);
      expect(DAILY_LIMITS[kind].plus).toBeGreaterThan(0);
      expect(DAILY_LIMITS[kind].pro).toBeGreaterThan(DAILY_LIMITS[kind].plus);
    }
  });

  it("armar un plan (lo más caro) tiene un cupo menor que entender el proyecto", () => {
    expect(DAILY_LIMITS.project_plan.plus).toBeLessThan(DAILY_LIMITS.project_intake.plus);
    expect(DAILY_LIMITS.project_plan.pro).toBeLessThan(DAILY_LIMITS.project_intake.pro);
  });
});

describe("autenticación", () => {
  it("todas las rutas responden 401 sin sesión y no hacen nada", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("no session"));
    const responses = await Promise.all([
      intake(req("/api/projects/intake", basics())),
      plan(req("/api/projects/plan", basics())),
      preview(req("/api/projects/preview", {})),
      create(req("/api/projects", {})),
      list(req("/api/projects", undefined, "GET")),
      patchProjects(req("/api/projects", { action: "add-minutes", extraMin: 30 }, "PATCH")),
      patchSubtask(req("/api/projects/subtasks", { subtaskId: "s", action: "skip" }, "PATCH")),
      extract(req("/api/projects/extract", undefined))
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(401));
    expect(mocks.runIntake).not.toHaveBeenCalled();
    expect(mocks.consumeDailyUsage).not.toHaveBeenCalled();
  });
});

describe("plan Free", () => {
  beforeEach(() => mocks.getUserPlan.mockResolvedValue("free"));

  it("todo lo que crea o usa IA responde 403 PLAN_REQUIRED, sin tocar la IA ni el contador", async () => {
    const responses = await Promise.all([
      intake(req("/api/projects/intake", basics())),
      plan(req("/api/projects/plan", basics())),
      preview(req("/api/projects/preview", { ...basics(), subtasks: subtasks() })),
      create(req("/api/projects", { ...basics(), subtasks: subtasks() })),
      extract(req("/api/projects/extract", undefined))
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(403));
    for (const response of responses) expect((await response.json()).code).toBe("PLAN_REQUIRED");
    expect(mocks.runIntake).not.toHaveBeenCalled();
    expect(mocks.runPlan).not.toHaveBeenCalled();
    expect(mocks.createFromDraft).not.toHaveBeenCalled();
    expect(mocks.consumeDailyUsage).not.toHaveBeenCalled();
  });

  it("pero puede ver y avanzar lo que ya tiene: es determinista y no gasta IA", async () => {
    expect((await list(req("/api/projects", undefined, "GET"))).status).toBe(200);
    mocks.applySubtaskAction.mockResolvedValue({ views: [], projectDone: false });
    expect((await patchSubtask(req("/api/projects/subtasks", { subtaskId: "s1", action: "skip" }, "PATCH"))).status).toBe(200);
    mocks.moveDeadline.mockResolvedValue([]);
    const moved = await patchProjects(req("/api/projects", { action: "move-deadline", projectId: "p1", deadline: future() }, "PATCH"));
    expect(moved.status).toBe(200);
  });
});

describe("intake", () => {
  it("con plan Plus consume el cupo project_intake y devuelve lo entendido", async () => {
    const res = await intake(req("/api/projects/intake", { ...basics(), uiLanguage: "es" }));
    expect(res.status).toBe(200);
    expect((await res.json()).understanding).toMatch(/TP individual/);
    expect(mocks.consumeDailyUsage).toHaveBeenCalledWith("u1", "project_intake", "plus");
    expect(mocks.runIntake).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "TP de álgebra", language: "Spanish" }));
  });

  it("con el cupo agotado responde 429 y no llama a la IA", async () => {
    mocks.consumeDailyUsage.mockResolvedValue({ allowed: false, limit: 15 });
    const res = await intake(req("/api/projects/intake", basics()));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("DAILY_LIMIT_REACHED");
    expect(mocks.runIntake).not.toHaveBeenCalled();
  });

  it("valida antes de gastar cupo: un pedido inválido no consume nada", async () => {
    for (const body of [{ ...basics(), title: "" }, { ...basics(), deadline: "2020-01-01" }, { ...basics(), deadline: "mañana" }, { ...basics(), description: "x".repeat(2001) }, null]) {
      const res = await intake(req("/api/projects/intake", body));
      expect(res.status).toBe(400);
    }
    expect(mocks.consumeDailyUsage).not.toHaveBeenCalled();
  });

  it("un error de la IA se traduce a un mensaje entendible", async () => {
    mocks.runIntake.mockRejectedValue(new ProjectAiError("INVALID_INTAKE", "x"));
    const res = await intake(req("/api/projects/intake", basics()));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("INVALID_INTAKE");
  });
});

describe("plan", () => {
  it("consume project_plan, corre la IA y devuelve el plan del scheduler", async () => {
    const res = await plan(req("/api/projects/plan", { ...basics(), understanding: "Un TP", answers: [{ id: "q1", question: "¿Grupal?", answer: "No" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.feasible).toBe(true);
    expect(body.inflation).toBe(1.3);
    expect(mocks.consumeDailyUsage).toHaveBeenCalledWith("u1", "project_plan", "plus");
    expect(mocks.runPlan).toHaveBeenCalledWith("u1", expect.objectContaining({ understanding: "Un TP", answers: [{ id: "q1", question: "¿Grupal?", answer: "No" }] }));
    expect(mocks.previewDraft).toHaveBeenCalledWith("u1", expect.any(String), expect.objectContaining({ subtasks: subtasks(), extraMinPerDay: 0 }));
  });

  it("cupo agotado: 429 sin IA", async () => {
    mocks.consumeDailyUsage.mockResolvedValue({ allowed: false, limit: 6 });
    expect((await plan(req("/api/projects/plan", basics()))).status).toBe(429);
    expect(mocks.runPlan).not.toHaveBeenCalled();
  });

  it("un plan inválido tras el reintento responde con un mensaje claro", async () => {
    mocks.runPlan.mockRejectedValue(new ProjectAiError("INVALID_PLAN", "Circular dependency"));
    const res = await plan(req("/api/projects/plan", basics()));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PLAN");
    expect(body.error).toMatch(/no pudo armar un plan válido/);
  });
});

describe("preview y crear", () => {
  it("preview no gasta IA ni cupo", async () => {
    const res = await preview(req("/api/projects/preview", { ...basics(), subtasks: subtasks() }));
    expect(res.status).toBe(200);
    expect(mocks.consumeDailyUsage).not.toHaveBeenCalled();
    expect(mocks.runPlan).not.toHaveBeenCalled();
  });

  it("valida las subtareas que edita el usuario con las mismas reglas que la IA", async () => {
    const bad = (sub: unknown[]) => preview(req("/api/projects/preview", { ...basics(), subtasks: sub }));
    expect((await bad([])).status).toBe(400);
    expect((await bad([{ tempId: "a", title: "Hacer algo", estimateMin: 5, dependsOn: [] }])).status).toBe(400);
    expect((await bad([{ tempId: "a", title: "Hacer A", estimateMin: 30, dependsOn: ["b"] }, { tempId: "b", title: "Hacer B", estimateMin: 30, dependsOn: ["a"] }])).status).toBe(400);
    expect((await bad(subtasks())).status).toBe(200); // una sola subtarea: el usuario puede recortar
  });

  it("crear pasa los datos validados al servicio y nunca acepta sesiones del cliente", async () => {
    const res = await create(req("/api/projects", { ...basics(), subtasks: subtasks(), sessions: [{ date: "2026-01-01" }], dailyCapMin: 60, extraMinPerDay: 20 }));
    expect(res.status).toBe(200);
    const draft = mocks.createFromDraft.mock.calls[0][2];
    expect(draft).toMatchObject({ title: "TP de álgebra", dailyCapMin: 60, extraMinPerDay: 20 });
    expect(draft).not.toHaveProperty("sessions");
  });

  it("respeta el tope de proyectos activos y el de tareas", async () => {
    const { ProjectLimitError } = await import("@/lib/projects-service");
    mocks.createFromDraft.mockRejectedValue(new ProjectLimitError());
    const limited = await create(req("/api/projects", { ...basics(), subtasks: subtasks() }));
    expect(limited.status).toBe(403);
    expect((await limited.json()).error).toBe("PROJECT_LIMIT_REACHED");

    mocks.countUserTasks.mockResolvedValue(1000);
    const full = await create(req("/api/projects", { ...basics(), subtasks: subtasks() }));
    expect((await full.json()).error).toBe("TASK_LIMIT_REACHED");
  });

  it("valida el tope diario y los minutos extra", async () => {
    for (const extra of [{ dailyCapMin: 0 }, { dailyCapMin: 1.5 }, { dailyCapMin: 2000 }, { extraMinPerDay: -1 }, { extraMinPerDay: "20" }]) {
      expect((await create(req("/api/projects", { ...basics(), subtasks: subtasks(), ...extra }))).status).toBe(400);
    }
  });
});

describe("subtareas y ajustes", () => {
  it("valida la acción y los minutos", async () => {
    const send = (body: unknown) => patchSubtask(req("/api/projects/subtasks", body, "PATCH"));
    mocks.applySubtaskAction.mockResolvedValue({ views: [], projectDone: false });
    expect((await send({ subtaskId: "s", action: "explotar" })).status).toBe(400);
    expect((await send({ action: "skip" })).status).toBe(400);
    expect((await send({ subtaskId: "s", action: "complete", actualMin: 0 })).status).toBe(400);
    expect((await send({ subtaskId: "s", action: "complete", actualMin: "45" })).status).toBe(400);
    expect((await send({ subtaskId: "s", action: "progress" })).status).toBe(400);
    expect((await send({ subtaskId: "s", action: "complete" })).status).toBe(200);
    expect(mocks.applySubtaskAction).toHaveBeenLastCalledWith("u1", expect.any(String), "s", { action: "complete", actualMin: null });
    expect((await send({ subtaskId: "s", action: "complete", actualMin: 45 })).status).toBe(200);
    expect(mocks.applySubtaskAction).toHaveBeenLastCalledWith("u1", expect.any(String), "s", { action: "complete", actualMin: 45 });
  });

  it("una subtarea que no es del usuario responde 404", async () => {
    mocks.applySubtaskAction.mockResolvedValue(null);
    expect((await patchSubtask(req("/api/projects/subtasks", { subtaskId: "ajena", action: "skip" }, "PATCH"))).status).toBe(404);
  });

  it("mover la fecha valida el pedido y un proyecto ajeno responde 404", async () => {
    const send = (body: unknown) => patchProjects(req("/api/projects", body, "PATCH"));
    expect((await send({ action: "move-deadline", projectId: "p", deadline: "2020-01-01" })).status).toBe(400);
    expect((await send({ action: "move-deadline", deadline: future() })).status).toBe(400);
    mocks.moveDeadline.mockResolvedValue(null);
    expect((await send({ action: "move-deadline", projectId: "ajeno", deadline: future() })).status).toBe(404);
    expect((await send({ action: "add-minutes", extraMin: 0 })).status).toBe(400);
    expect((await send({ action: "add-minutes", extraMin: 9999 })).status).toBe(400);
    expect((await send({ action: "otra" })).status).toBe(400);
  });
});

describe("extract", () => {
  const upload = (file: File, extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("file", file);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return extract(new Request("http://localhost/api/projects/extract", { method: "POST", body: form }));
  };

  it("lee un archivo corto y guarda su texto tal cual, sin gastar IA", async () => {
    const res = await upload(new File(["Entregar el informe el 15/10."], "consigna.txt", { type: "text/plain" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ name: "consigna.txt", kind: "text", truncated: false });
    expect(body.summary).toContain("Entregar el informe el 15/10.");
    expect(mocks.consumeDailyUsage).not.toHaveBeenCalled();
    expect(mocks.summarizeText).not.toHaveBeenCalled();
  });

  it("un texto largo se resume con IA y ahí sí se cuenta el cupo, una sola vez", async () => {
    mocks.summarizeText.mockResolvedValue("Resumen breve.");
    const res = await upload(new File(["palabra ".repeat(3000)], "largo.txt", { type: "text/plain" }));
    expect(res.status).toBe(200);
    expect((await res.json()).summary).toContain("Resumen breve.");
    expect(mocks.consumeDailyUsage).toHaveBeenCalledTimes(1);
    expect(mocks.consumeDailyUsage).toHaveBeenCalledWith("u1", "project_intake", "plus");
  });

  it("con el cupo agotado a mitad del resumen responde 429", async () => {
    mocks.consumeDailyUsage.mockResolvedValue({ allowed: false, limit: 15 });
    const res = await upload(new File(["palabra ".repeat(3000)], "largo.txt", { type: "text/plain" }));
    expect(res.status).toBe(429);
    expect(mocks.summarizeText).not.toHaveBeenCalled();
  });

  it("las imágenes quedan afuera con un código propio y un tipo no soportado también", async () => {
    const image = await upload(new File(["x"], "foto.png", { type: "image/png" }));
    expect(image.status).toBe(415);
    expect((await image.json()).code).toBe("IMAGES_UNSUPPORTED");
    const other = await upload(new File(["x"], "planilla.xlsx"));
    expect(other.status).toBe(415);
    expect((await other.json()).code).toBe("UNSUPPORTED_TYPE");
  });

  it("rechaza un archivo demasiado grande y uno vacío", async () => {
    const big = await upload(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.txt", { type: "text/plain" }));
    expect(big.status).toBe(413);
    const empty = await upload(new File([""], "vacio.txt", { type: "text/plain" }));
    expect(empty.status).toBe(422);
  });

  it("sin archivo o con un cuerpo que no es un formulario, 400", async () => {
    expect((await extract(new Request("http://localhost/api/projects/extract", { method: "POST", body: new FormData() }))).status).toBe(400);
    expect((await extract(new Request("http://localhost/api/projects/extract", { method: "POST", body: "hola" }))).status).toBe(400);
  });
});
