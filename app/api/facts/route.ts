import "server-only";
import { NextResponse } from "next/server";
import { authenticate, badRequest, readBody } from "@/lib/checklist-route";
import { deleteAllFacts, deleteFact, listFacts, saveFact, updateFactValue } from "@/lib/facts-storage";
import { validateFact } from "@/lib/user-facts";

const SENSITIVE = () =>
  NextResponse.json(
    { error: "Spark doesn't store health, money, ID or belief information.", code: "SENSITIVE" },
    { status: 422 }
  );

// GET /api/facts — todo lo que Spark sabe de este usuario.
export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ facts: await listFacts(auth.userId) });
  } catch (error) {
    console.error("[facts] list failed", error);
    return NextResponse.json({ error: "Failed to load facts" }, { status: 500 });
  }
}

// POST /api/facts — { key, value, source?: "inferred", confidence? }
//
// Es lo que usa el chat cuando el usuario CONFIRMA un hecho que Milo dedujo. Los `stated` los
// guarda la tool remember_fact (que comprueba que el usuario lo haya dicho), no esta ruta.
export async function POST(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const body = await readBody(request);
  if (!body) return badRequest("Invalid body");
  const check = validateFact({ key: body.key, value: body.value });
  if (!check.ok) return check.reason === "sensitive" ? SENSITIVE() : badRequest(`Invalid ${check.reason}`);

  const confidence =
    typeof body.confidence === "number" && Number.isFinite(body.confidence) ? Math.min(0.95, Math.max(0.1, body.confidence)) : 0.6;
  try {
    const result = await saveFact(auth.userId, { key: check.key, value: check.value, source: "inferred", confidence });
    if (result.status === "limit") return NextResponse.json({ error: "Too many facts", code: "FACT_LIMIT" }, { status: 409 });
    if (result.status === "exists_stated") return NextResponse.json({ error: "Already known", code: "ALREADY_STATED" }, { status: 409 });
    return NextResponse.json({ fact: result.fact });
  } catch (error) {
    console.error("[facts] save failed", error);
    return NextResponse.json({ error: "Failed to save the fact" }, { status: 500 });
  }
}

// PUT /api/facts — { id, value }: el usuario edita un hecho. Pasa a ser `stated`.
export async function PUT(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const body = await readBody(request);
  if (!body || typeof body.id !== "string") return badRequest("id is required");
  // La clave no cambia al editar; se valida el valor con una clave neutra.
  const check = validateFact({ key: "dato", value: body.value });
  if (!check.ok) return check.reason === "sensitive" ? SENSITIVE() : badRequest(`Invalid ${check.reason}`);

  try {
    const fact = await updateFactValue(auth.userId, body.id, check.value);
    return fact ? NextResponse.json({ fact }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("[facts] update failed", error);
    return NextResponse.json({ error: "Failed to update the fact" }, { status: 500 });
  }
}

// DELETE /api/facts?id=<id>  o  ?all=1 — borra de verdad: un DELETE, sin marca ni copia.
export async function DELETE(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const params = new URL(request.url).searchParams;
  try {
    if (params.get("all") === "1") return NextResponse.json({ deleted: await deleteAllFacts(auth.userId) });
    const id = params.get("id");
    if (!id) return badRequest("id or all=1 is required");
    return (await deleteFact(auth.userId, id))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("[facts] delete failed", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
