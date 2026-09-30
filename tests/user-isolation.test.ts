import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Guardrails for "every user has their own corner": these read the source and
 * fail if a query or a cache stops being scoped to one account.
 */

function read(path: string) {
  return readFileSync(path, "utf8");
}

function apiRoutes(): string[] {
  return execSync("git ls-files 'app/api/**/route.ts'", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

describe("database access", () => {
  it("scopes every task query to the owner", () => {
    const storage = read("lib/storage.ts");
    // Every statement that reads or changes tasks must carry user_id.
    const statements = storage.match(/sql`[\s\S]*?`/g) ?? [];
    const taskStatements = statements.filter((s) => /\btasks\b/i.test(s));
    expect(taskStatements.length).toBeGreaterThan(0);
    for (const statement of taskStatements) {
      expect(statement, `unscoped task query:\n${statement}`).toMatch(/user_id/);
    }
  });

  it("scopes every series, subtask and settings query to the owner", () => {
    // Series and occurrences are the newest place a task can leak across
    // accounts: a series id or a task id from another user must find nothing.
    for (const path of ["lib/series-storage.ts", "lib/user-settings.ts", "lib/projects-storage.ts"]) {
      const statements = read(path).match(/sql`[\s\S]*?`/g) ?? [];
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement, `unscoped query in ${path}:\n${statement}`).toMatch(/user_id/);
        // Reads and writes by id must compare user_id to the caller, not merely
        // mention the column. (Inserts carry it as a value, which is enough.)
        if (/^\s*sql`\s*(SELECT|UPDATE|DELETE)/i.test(statement)) {
          expect(statement, `by-id query without an owner check in ${path}:\n${statement}`).toMatch(
            /user_id\s*=\s*\$\{/
          );
        }
      }
    }
  });

  it("never queries subtasks without the owner", () => {
    // The table exists but nothing reads it yet (stage 3). This guards the day
    // something does: any statement that touches it must be scoped.
    const files = execSync("git ls-files 'lib/**/*.ts' 'app/**/*.ts'", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    for (const path of files) {
      const statements = read(path).match(/sql`[\s\S]*?`/g) ?? [];
      for (const statement of statements.filter((s) => /\bsubtasks\b/i.test(s))) {
        expect(statement, `unscoped subtasks query in ${path}:\n${statement}`).toMatch(/user_id\s*=\s*\$\{/);
      }
    }
  });

  it("keeps per-user tables keyed by user_id", () => {
    for (const path of ["lib/user-memory.ts", "lib/usage-limits.ts"]) {
      const statements = read(path).match(/sql`[\s\S]*?`/g) ?? [];
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement, `unscoped query in ${path}:\n${statement}`).toMatch(/user_id/);
      }
    }
  });
});

describe("schema", () => {
  const schema = read("neon/schema.sql");

  it("gives every new per-user table a user_id", () => {
    for (const table of ["task_series", "subtasks", "user_settings"]) {
      const body = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`))?.[1];
      expect(body, `${table} is missing from the schema`).toBeDefined();
      expect(body, `${table} has no user_id`).toMatch(/\buser_id\s+TEXT/);
    }
  });

  it("makes an occurrence unique per series and date", () => {
    expect(schema).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS tasks_series_occurrence_uniq\s+ON tasks \(series_id, occurrence_date\) WHERE series_id IS NOT NULL/
    );
  });
});

describe("API routes", () => {
  it("require an authenticated user, except the signed payment webhook", () => {
    for (const route of apiRoutes()) {
      const source = read(route);
      // The webhook has no session to check — its identity guarantee is the
      // provider's HMAC over the raw body. Mercado Pago used its own SDK
      // validator; Lemon Squeezy uses the one in lib/lemonsqueezy.ts. Either
      // way the route must contain a signature check, never neither.
      // The project routes authenticate through lib/project-route.ts, checked below.
      const guarded =
        /requireAuth(WithEmail)?\s*\(/.test(source) ||
        /\bauthenticate(Paid)?\s*\(/.test(source) ||
        /WebhookSignatureValidator|verifyWebhookSignature/.test(source);
      expect(guarded, `${route} has no identity check`).toBe(true);
    }
  });
});

describe("project routes", () => {
  it("authenticate() really is requireAuth", () => {
    expect(read("lib/project-route.ts")).toMatch(/requireAuth\s*\(/);
  });

  it("every project route authenticates before doing anything else", () => {
    for (const route of apiRoutes().filter((r) => r.includes("api/projects"))) {
      const source = read(route);
      expect(source, `${route} never authenticates`).toMatch(/authenticate\s*\(/);
      // The check has to come first in each handler, not after a database read.
      for (const handler of source.split(/export async function /).slice(1)) {
        expect(handler, `${route}: a handler reads before it authenticates`).toMatch(/^[A-Z]+\(request(: Request)?\)\s*\{\s*const auth = await authenticate\(\)/);
      }
    }
  });
});

describe("hechos, checklists y ubicación", () => {
  const routes = () =>
    apiRoutes().filter((r) => /api\/(facts|checklists|settings\/location)/.test(r));

  it("hay rutas y authenticate() es requireAuth", () => {
    expect(routes().length).toBeGreaterThanOrEqual(5);
    expect(read("lib/checklist-route.ts")).toMatch(/requireAuth\s*\(/);
  });

  it("cada handler autentica antes de leer o escribir nada", () => {
    for (const route of routes()) {
      const source = read(route);
      for (const handler of source.split(/export async function /).slice(1)) {
        expect(handler, `${route}: un handler toca datos antes de autenticar`).toMatch(
          /^[A-Z]+\((request: Request)?\)\s*\{\s*const auth = await authenticate(Paid)?\(\)/
        );
      }
    }
  });

  it("ninguna lectura de hechos, listas o ubicación recibe un userId que no sea el autenticado", () => {
    // Las rutas pasan `auth.userId` y nada que venga del cuerpo o de la URL.
    for (const route of routes()) {
      const source = read(route);
      expect(source, route).not.toMatch(/body\.userId|searchParams\.get\("(user|userId|user_id)"\)/);
    }
  });

  it("todas las consultas de esas tablas filtran por user_id", () => {
    for (const file of ["lib/facts-storage.ts", "lib/checklists-storage.ts"]) {
      const source = read(file);
      const queries = source.match(/sql`[\s\S]*?`/g) ?? [];
      expect(queries.length).toBeGreaterThan(0);
      for (const query of queries) {
        expect(query, `${file}: una consulta sin user_id`).toMatch(/user_id/);
      }
    }
  });
});

describe("patrones del usuario (etapa 6)", () => {
  it("la ruta de patrones autentica y no toma un userId de la petición", () => {
    const source = read("app/api/patterns/route.ts");
    expect(source).toMatch(/requireAuth\s*\(/);
    expect(source).not.toMatch(/searchParams|request\.json|body\.userId/);
  });

  it("el historial filtra por user_id en cada consulta, también la de subtareas", () => {
    const source = read("lib/user-history.ts");
    const queries = source.match(/sql`[\s\S]*?`/g) ?? [];
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query, "consulta del historial sin dueño").toMatch(/user_id\s*=\s*\$\{userId\}/);
    }
    // El JOIN a tasks no puede cruzar cuentas: también compara el dueño.
    expect(queries[1]).toMatch(/t\.user_id\s*=\s*s\.user_id/);
  });

  it("el loader nace con el userId: no hay cache compartido entre usuarios", () => {
    const source = read("lib/user-history.ts");
    expect(source).toMatch(/export function patternsLoader\(userId: string/);
    // Nada a nivel de módulo que guarde resultados de un usuario para otro.
    expect(source).not.toMatch(/^(const|let) \w*[Cc]ache\b/m);
    expect(source).not.toMatch(/new Map\(/);
  });

  it("las escrituras nuevas de tareas y subtareas comparan user_id", () => {
    for (const [path, fn] of [
      ["lib/storage.ts", "addTaskProgress"],
      ["lib/storage.ts", "moveTaskPlannedDate"],
      ["lib/storage.ts", "setTaskPinned"],
      ["lib/storage.ts", "setTaskDone"]
    ] as const) {
      const source = read(path);
      const body = source.slice(source.indexOf(`function ${fn}`));
      const query = body.match(/sql`[\s\S]*?`/)?.[0] ?? "";
      expect(query, `${fn} sin dueño`).toMatch(/user_id\s*=\s*\$\{userId\}/);
    }
  });
});

describe("agenda ocupada (etapa 7)", () => {
  it("el margen por usuario se lee y guarda solo por user_id (user-settings ya está guardado arriba)", () => {
    const source = read("lib/user-settings.ts");
    const prep = source.slice(source.indexOf("getPrepSettings"));
    for (const query of prep.match(/sql`[\s\S]*?`/g) ?? []) expect(query).toMatch(/user_id/);
  });

  it("las fuentes de bloques reciben el usuario y no hay cache a nivel de módulo", () => {
    const source = read("lib/busy-blocks-server.ts");
    expect(source).toMatch(/load: \(userId: string/);
    expect(source).not.toMatch(/new Map\(/);
    expect(source).not.toMatch(/^(const|let) \w*[Cc]ache\b/m);
  });
});

describe("replanificación (etapa 8)", () => {
  it("cada consulta de replan-storage compara user_id con el usuario que se le pasa", () => {
    const queries = read("lib/replan-storage.ts").match(/sql`[\s\S]*?`/g) ?? [];
    expect(queries.length).toBeGreaterThanOrEqual(9);
    for (const query of queries) expect(query, `consulta sin dueño:\n${query}`).toMatch(/user_id\s*=\s*\$\{userId\}/);
  });

  it("la ruta de replan autentica antes de leer y no toma un userId del cuerpo", () => {
    const source = read("app/api/replan/route.ts");
    for (const handler of source.split(/export async function /).slice(1)) {
      expect(handler).toMatch(/^[A-Z]+\((request: Request)?\)\s*\{\s*let userId: string;\s*try \{ userId = await requireAuth\(\); \}/);
    }
    expect(source).not.toMatch(/body\.userId|body\.user_id/);
  });

  it("las tools de Milo que cambian tareas (replan, fijar) se atan al usuario en un solo lugar", () => {
    const source = read("lib/milo-tools-server.ts");
    expect(source).toMatch(/replanAll\(userId,/);
    expect(source).toMatch(/setTaskPinned\(id, pinned, userId\)/);
    expect(source).toMatch(/loadTasks\(userId\)/);
  });
});

describe("server-side AI caches", () => {
  it("include the user in the cache key", () => {
    // These Maps live in the server process and are shared by every request.
    for (const [path, builder] of [
      ["app/api/ai-priority/route.ts", "buildRecommendationCacheKey"],
      ["app/api/ai-task-help/route.ts", "buildTaskHelpCacheKey"]
    ] as const) {
      const source = read(path);
      const fn = source.slice(source.indexOf(`function ${builder}`));
      const body = fn.slice(0, fn.indexOf("\n}"));
      expect(body, `${builder} is not scoped per user`).toMatch(/userId/);
    }
  });
});
