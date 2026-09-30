import { beforeEach, describe, expect, it, vi } from "vitest";
import { computePatterns } from "@/lib/user-patterns";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), load: vi.fn(), patternsLoader: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/user-history", () => ({ patternsLoader: mocks.patternsLoader }));

import { GET } from "@/app/api/patterns/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue("user_A");
  mocks.load.mockResolvedValue(computePatterns([]));
  mocks.patternsLoader.mockReturnValue(mocks.load);
});

describe("GET /api/patterns", () => {
  it("sin sesión: 401 y no lee nada", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("no session"));
    expect((await GET()).status).toBe(401);
    expect(mocks.patternsLoader).not.toHaveBeenCalled();
  });

  it("lee solo los patrones del usuario autenticado", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(mocks.patternsLoader).toHaveBeenCalledWith("user_A");
    const { patterns } = await res.json();
    expect(patterns.hours).toMatchObject({ learned: false, needed: 15 });
  });

  it("un fallo de la base es un 500 sin detalles", async () => {
    mocks.load.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/db down/);
  });
});
