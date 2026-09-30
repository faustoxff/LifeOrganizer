import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { patternsLoader } from "@/lib/user-history";

// GET /api/patterns — lo que Spark aprendió de cómo trabaja el usuario autenticado.
//
// Estadística sobre sus últimos 90 días, sin IA y sin costo: no se limita por plan (un usuario
// que baja de plan sigue viendo los números de sus propios datos). Solo lee lo del usuario
// que autenticó; nada de la URL ni del cuerpo elige de quién son los datos.
export async function GET() {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ patterns: await patternsLoader(userId)() });
  } catch (err) {
    console.error("loadPatterns failed", err);
    return NextResponse.json({ error: "Failed to load patterns" }, { status: 500 });
  }
}
