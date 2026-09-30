import "server-only";
import { NextResponse } from "next/server";
import { parsePrepMin } from "@/lib/busy-blocks";
import { requireAuth } from "@/lib/server-auth";
import { getPrepSettings, savePrepSettings } from "@/lib/user-settings";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// GET /api/settings/prep — el margen (min) antes de un compromiso, por tipo de bloque.
export async function GET() {
  let userId: string;
  try { userId = await requireAuth(); }
  catch { return unauthorized(); }

  try {
    return NextResponse.json(await getPrepSettings(userId));
  } catch (err) {
    console.error("getPrepSettings failed", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

// PUT /api/settings/prep — { calendarMin, reminderMin }, enteros de 0 a 240. Se rechaza entero si algo no es válido.
export async function PUT(request: Request) {
  let userId: string;
  try { userId = await requireAuth(); }
  catch { return unauthorized(); }

  const body = (await request.json().catch(() => null)) as { calendarMin?: unknown; reminderMin?: unknown } | null;
  const calendarMin = parsePrepMin(body?.calendarMin);
  const reminderMin = parsePrepMin(body?.reminderMin);
  if (calendarMin === null || reminderMin === null) {
    return NextResponse.json({ error: "Invalid margins" }, { status: 400 });
  }

  try {
    await savePrepSettings(userId, { calendarMin, reminderMin });
    return NextResponse.json({ calendarMin, reminderMin });
  } catch (err) {
    console.error("savePrepSettings failed", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
