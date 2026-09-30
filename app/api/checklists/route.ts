import "server-only";
import { NextResponse } from "next/server";
import { authenticate, badRequest } from "@/lib/checklist-route";
import { deleteAllLists, deleteAllTitleActivities, deleteList, listLists } from "@/lib/checklists-storage";

// GET /api/checklists — las listas que Spark aprendió de este usuario, para la pantalla
// "Lo que Spark sabe de vos". Se pueden ver siempre, sea cual sea el plan.
export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ lists: await listLists(auth.userId) });
  } catch (error) {
    console.error("[checklists] list failed", error);
    return NextResponse.json({ error: "Failed to load checklists" }, { status: 500 });
  }
}

// DELETE /api/checklists?id=<id>  o  ?all=1 — borra de verdad, sin copia.
export async function DELETE(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const params = new URL(request.url).searchParams;
  try {
    if (params.get("all") === "1") {
      // Con las listas se va también lo que se clasificó por título: es lo mismo, aprendido.
      await deleteAllTitleActivities(auth.userId);
      return NextResponse.json({ deleted: await deleteAllLists(auth.userId) });
    }
    const id = params.get("id");
    if (!id) return badRequest("id or all=1 is required");
    return (await deleteList(auth.userId, id))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("[checklists] delete failed", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
