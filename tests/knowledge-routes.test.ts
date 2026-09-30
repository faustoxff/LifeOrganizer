import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las rutas de hechos, checklists y ubicación: quién puede entrar, qué se rechaza y que cada
 * lectura/escritura lleve el usuario autenticado. La base y la IA están reemplazadas.
 */
const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getUserPlan: vi.fn(),
  listFacts: vi.fn(),
  saveFact: vi.fn(),
  updateFactValue: vi.fn(),
  deleteFact: vi.fn(),
  deleteAllFacts: vi.fn(),
  listLists: vi.fn(),
  deleteList: vi.fn(),
  deleteAllLists: vi.fn(),
  deleteAllTitleActivities: vi.fn(),
  saveApproxLocation: vi.fn(),
  getApproxLocation: vi.fn(),
  clearApproxLocation: vi.fn(),
  detectActivities: vi.fn(),
  resolveChecklist: vi.fn(),
  editChecklist: vi.fn(),
  dismissActivity: vi.fn()
}));

vi.mock("@/lib/db", () => ({ default: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ requireAuth: mocks.requireAuth, getUserPlan: mocks.getUserPlan }));
vi.mock("@/lib/facts-storage", () => ({
  listFacts: mocks.listFacts,
  saveFact: mocks.saveFact,
  updateFactValue: mocks.updateFactValue,
  deleteFact: mocks.deleteFact,
  deleteAllFacts: mocks.deleteAllFacts
}));
vi.mock("@/lib/checklists-storage", () => ({
  listLists: mocks.listLists,
  deleteList: mocks.deleteList,
  deleteAllLists: mocks.deleteAllLists,
  deleteAllTitleActivities: mocks.deleteAllTitleActivities
}));
vi.mock("@/lib/user-settings", () => ({
  saveApproxLocation: mocks.saveApproxLocation,
  getApproxLocation: mocks.getApproxLocation,
  clearApproxLocation: mocks.clearApproxLocation,
  resolveUserTimeZone: async () => "UTC"
}));
vi.mock("@/lib/checklists-runtime", () => ({ checklistDeps: () => ({}), checklistStore: {} }));
vi.mock("@/lib/checklists-service", () => ({
  detectActivities: mocks.detectActivities,
  resolveChecklist: mocks.resolveChecklist,
  editChecklist: mocks.editChecklist,
  dismissActivity: mocks.dismissActivity,
  learnFromCompletion: vi.fn()
}));

import { DELETE as deleteChecklists, GET as getChecklists } from "@/app/api/checklists/route";
import { POST as detect } from "@/app/api/checklists/detect/route";
import { DELETE as dismiss, PATCH as edit, POST as resolve } from "@/app/api/checklists/task/route";
import { DELETE as deleteFacts, GET as getFacts, POST as postFact, PUT as putFact } from "@/app/api/facts/route";
import { DELETE as deleteLocation, GET as getLocation, PUT as putLocation } from "@/app/api/settings/location/route";

const req = (path: string, method = "POST", body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue("user_A");
  mocks.getUserPlan.mockResolvedValue("plus");
  mocks.listFacts.mockResolvedValue([]);
  mocks.listLists.mockResolvedValue([]);
  mocks.saveFact.mockImplementation(async (_u: string, f: { key: string; value: string }) => ({ status: "saved", fact: { id: "f1", ...f } }));
  mocks.detectActivities.mockResolvedValue({});
  mocks.resolveChecklist.mockResolvedValue({ status: "ok", checklist: { activityKey: "gimnasio", items: [] } });
  mocks.editChecklist.mockResolvedValue({ status: "ok", checklist: { activityKey: "gimnasio", items: [] } });
  mocks.dismissActivity.mockResolvedValue(true);
});

describe("sin sesión: 401 en todas", () => {
  it("ninguna ruta hace nada sin usuario", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("no"));
    const responses = await Promise.all([
      getFacts(),
      postFact(req("/api/facts", "POST", { key: "a1", value: "x" })),
      putFact(req("/api/facts", "PUT", { id: "1", value: "x" })),
      deleteFacts(req("/api/facts?all=1", "DELETE")),
      getChecklists(),
      deleteChecklists(req("/api/checklists?all=1", "DELETE")),
      detect(req("/api/checklists/detect", "POST", { tasks: [] })),
      resolve(req("/api/checklists/task", "POST", { taskId: "t" })),
      edit(req("/api/checklists/task", "PATCH", { taskId: "t", op: "add", text: "x" })),
      dismiss(req("/api/checklists/task?taskId=t", "DELETE")),
      getLocation(),
      putLocation(req("/api/settings/location", "PUT", { lat: 1, lon: 1 })),
      deleteLocation()
    ]);
    for (const res of responses) expect(res.status).toBe(401);
    for (const fn of [mocks.listFacts, mocks.saveFact, mocks.deleteAllFacts, mocks.deleteAllLists, mocks.detectActivities, mocks.resolveChecklist, mocks.saveApproxLocation]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("Free: puede ver y borrar lo suyo, no usar las checklists", () => {
  beforeEach(() => mocks.getUserPlan.mockResolvedValue("free"));

  it("detectar, armar, editar y descartar son Plus/Pro (403 con PLAN_REQUIRED)", async () => {
    const responses = await Promise.all([
      detect(req("/api/checklists/detect", "POST", { tasks: [] })),
      resolve(req("/api/checklists/task", "POST", { taskId: "t" })),
      edit(req("/api/checklists/task", "PATCH", { taskId: "t", op: "add", text: "x" })),
      dismiss(req("/api/checklists/task?taskId=t", "DELETE"))
    ]);
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("PLAN_REQUIRED");
    }
    expect(mocks.detectActivities).not.toHaveBeenCalled();
    expect(mocks.resolveChecklist).not.toHaveBeenCalled();
  });

  it("ver y borrar lo que Spark sabe de él sí, siempre", async () => {
    expect((await getFacts()).status).toBe(200);
    expect((await getChecklists()).status).toBe(200);
    mocks.deleteAllFacts.mockResolvedValue(0);
    expect((await deleteFacts(req("/api/facts?all=1", "DELETE"))).status).toBe(200);
  });
});

describe("hechos", () => {
  it("todo va con el usuario autenticado", async () => {
    mocks.deleteFact.mockResolvedValue(true);
    mocks.deleteAllFacts.mockResolvedValue(3);
    mocks.updateFactValue.mockResolvedValue({ id: "f1", key: "k", value: "v" });
    await getFacts();
    await postFact(req("/api/facts", "POST", { key: "deportes", value: "pádel" }));
    await putFact(req("/api/facts", "PUT", { id: "f1", value: "yoga" }));
    await deleteFacts(req("/api/facts?id=f1", "DELETE"));
    await deleteFacts(req("/api/facts?all=1", "DELETE"));
    expect(mocks.listFacts).toHaveBeenCalledWith("user_A");
    expect(mocks.saveFact).toHaveBeenCalledWith("user_A", expect.objectContaining({ key: "deportes", source: "inferred" }));
    expect(mocks.updateFactValue).toHaveBeenCalledWith("user_A", "f1", "yoga");
    expect(mocks.deleteFact).toHaveBeenCalledWith("user_A", "f1");
    expect(mocks.deleteAllFacts).toHaveBeenCalledWith("user_A");
  });

  it("borrar un hecho ajeno o inexistente es 404 y no borra nada de otro", async () => {
    mocks.deleteFact.mockResolvedValue(false);
    expect((await deleteFacts(req("/api/facts?id=de_otro", "DELETE"))).status).toBe(404);
    expect(mocks.deleteFact).toHaveBeenCalledWith("user_A", "de_otro");
    expect((await deleteFacts(req("/api/facts", "DELETE"))).status).toBe(400);
  });

  it("confirmar un hecho deducido: siempre se guarda como inferred, aunque el cliente diga otra cosa", async () => {
    await postFact(req("/api/facts", "POST", { key: "estudia", value: "derecho", source: "stated", confidence: 5 }));
    expect(mocks.saveFact).toHaveBeenCalledWith("user_A", { key: "estudia", value: "derecho", source: "inferred", confidence: 0.95 });
  });

  it("rechaza datos sensibles al confirmar y al editar (422), sin escribir", async () => {
    const a = await postFact(req("/api/facts", "POST", { key: "salud", value: "tengo diabetes" }));
    const b = await putFact(req("/api/facts", "PUT", { id: "f1", value: "gano 500 mil de sueldo" }));
    for (const res of [a, b]) {
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("SENSITIVE");
    }
    expect(mocks.saveFact).not.toHaveBeenCalled();
    expect(mocks.updateFactValue).not.toHaveBeenCalled();
  });

  it("valida clave y valor", async () => {
    expect((await postFact(req("/api/facts", "POST", { key: "!!", value: "x" }))).status).toBe(400);
    expect((await postFact(req("/api/facts", "POST", { key: "ok_clave", value: "" }))).status).toBe(400);
    expect((await postFact(req("/api/facts", "POST", { key: "ok_clave", value: "x".repeat(300) }))).status).toBe(400);
    expect((await putFact(req("/api/facts", "PUT", { value: "x" }))).status).toBe(400);
  });

  it("los conflictos se explican: tope y ya dicho", async () => {
    mocks.saveFact.mockResolvedValueOnce({ status: "limit" }).mockResolvedValueOnce({ status: "exists_stated" });
    expect((await postFact(req("/api/facts", "POST", { key: "ok_clave", value: "x" }))).status).toBe(409);
    expect((await postFact(req("/api/facts", "POST", { key: "ok_clave", value: "x" }))).status).toBe(409);
  });
});

describe("listas aprendidas", () => {
  it("borrar todo también limpia la caché de títulos", async () => {
    mocks.deleteAllLists.mockResolvedValue(2);
    const res = await deleteChecklists(req("/api/checklists?all=1", "DELETE"));
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(mocks.deleteAllLists).toHaveBeenCalledWith("user_A");
    expect(mocks.deleteAllTitleActivities).toHaveBeenCalledWith("user_A");
  });

  it("borrar una ajena es 404", async () => {
    mocks.deleteList.mockResolvedValue(false);
    expect((await deleteChecklists(req("/api/checklists?id=x", "DELETE"))).status).toBe(404);
    expect(mocks.deleteList).toHaveBeenCalledWith("user_A", "x");
  });
});

describe("checklists de una tarea", () => {
  it("detectar valida la forma y el tope, y pasa el usuario", async () => {
    expect((await detect(req("/api/checklists/detect", "POST", {}))).status).toBe(400);
    expect((await detect(req("/api/checklists/detect", "POST", { tasks: [{ id: "a", title: "x", kind: "raro" }] }))).status).toBe(400);
    const many = Array.from({ length: 31 }, (_, n) => ({ id: `t${n}`, title: "x", kind: "task" }));
    expect((await detect(req("/api/checklists/detect", "POST", { tasks: many }))).status).toBe(400);
    mocks.detectActivities.mockResolvedValue({ a: "gimnasio" });
    const ok = await detect(req("/api/checklists/detect", "POST", { tasks: [{ id: "a", title: "Gimnasio", kind: "task" }] }));
    expect(await ok.json()).toEqual({ activities: { a: "gimnasio" } });
    expect(mocks.detectActivities.mock.calls[0][0]).toMatchObject({ userId: "user_A" });
  });

  it("armar devuelve la checklist, o null si no hay actividad, o 404", async () => {
    expect((await resolve(req("/api/checklists/task", "POST", {}))).status).toBe(400);
    expect((await (await resolve(req("/api/checklists/task", "POST", { taskId: "t" }))).json()).checklist.activityKey).toBe("gimnasio");
    mocks.resolveChecklist.mockResolvedValueOnce({ status: "no_activity" });
    expect(await (await resolve(req("/api/checklists/task", "POST", { taskId: "t" }))).json()).toEqual({ checklist: null });
    mocks.resolveChecklist.mockResolvedValueOnce({ status: "no_task" });
    expect((await resolve(req("/api/checklists/task", "POST", { taskId: "de_otro" }))).status).toBe(404);
    expect(mocks.resolveChecklist.mock.calls[0][0]).toMatchObject({ userId: "user_A" });
  });

  it("avisa cuando la lista vino vacía por un fallo de la IA", async () => {
    mocks.resolveChecklist.mockResolvedValueOnce({ status: "ok", checklist: { items: [] }, degraded: "ai_failed" });
    expect((await (await resolve(req("/api/checklists/task", "POST", { taskId: "t" }))).json()).degraded).toBe("ai_failed");
  });

  it("editar valida la operación y traduce los errores", async () => {
    expect((await edit(req("/api/checklists/task", "PATCH", { taskId: "t", op: "borrar", text: "x" }))).status).toBe(400);
    expect((await edit(req("/api/checklists/task", "PATCH", { taskId: "t", op: "add" }))).status).toBe(400);
    mocks.editChecklist.mockResolvedValueOnce({ status: "invalid", reason: "not_found" });
    expect((await edit(req("/api/checklists/task", "PATCH", { taskId: "t", op: "toggle", text: "x" }))).status).toBe(400);
    mocks.editChecklist.mockResolvedValueOnce({ status: "no_task" });
    expect((await edit(req("/api/checklists/task", "PATCH", { taskId: "otra", op: "toggle", text: "x" }))).status).toBe(404);
    const ok = await edit(req("/api/checklists/task", "PATCH", { taskId: "t", op: "add", text: "Agua" }));
    expect(ok.status).toBe(200);
    expect(mocks.editChecklist).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "user_A" }), "t", { op: "add", text: "Agua" }, expect.anything());
  });

  it("descartar pide taskId y 404 si no es suya", async () => {
    expect((await dismiss(req("/api/checklists/task", "DELETE"))).status).toBe(400);
    mocks.dismissActivity.mockResolvedValueOnce(false);
    expect((await dismiss(req("/api/checklists/task?taskId=x", "DELETE"))).status).toBe(404);
  });
});

describe("ubicación aproximada", () => {
  it("guarda REDONDEADA a 0,1°: nunca la exacta", async () => {
    const res = await putLocation(req("/api/settings/location", "PUT", { lat: -34.60372, lon: -58.38162 }));
    expect(await res.json()).toEqual({ location: { lat: -34.6, lon: -58.4 } });
    expect(mocks.saveApproxLocation).toHaveBeenCalledWith("user_A", { lat: -34.6, lon: -58.4 });
  });

  it("rechaza coordenadas inválidas", async () => {
    for (const body of [{}, { lat: 200, lon: 0 }, { lat: 0, lon: 999 }, { lat: "1", lon: 2 }, { lat: null, lon: null }]) {
      expect((await putLocation(req("/api/settings/location", "PUT", body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(mocks.saveApproxLocation).not.toHaveBeenCalled();
  });

  it("se lee y se borra por usuario", async () => {
    mocks.getApproxLocation.mockResolvedValue({ lat: 1, lon: 2 });
    expect(await (await getLocation()).json()).toEqual({ location: { lat: 1, lon: 2 } });
    await deleteLocation();
    expect(mocks.getApproxLocation).toHaveBeenCalledWith("user_A");
    expect(mocks.clearApproxLocation).toHaveBeenCalledWith("user_A");
  });
});
