import "server-only";
import { NextResponse } from "next/server";
import { getExternalBusyBlocks } from "@/lib/busy-blocks-server";
import { isDateKey, addDays } from "@/lib/recurrence";
import { requireAuth } from "@/lib/server-auth";
import { getTodayInTimeZone } from "@/lib/task-date";
import { getPrepSettings, resolveUserTimeZone } from "@/lib/user-settings";

// GET /api/busy?from=YYYY-MM-DD&to=YYYY-MM-DD — los compromisos que vienen de FUENTES EXTERNAS
// (Google Calendar, cuando esté). Los recordatorios y las tareas con hora ya están en el cliente y
// no se repiten acá. Hoy no hay fuentes registradas y devuelve una lista vacía.
export async function GET(request: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const timeZone = await resolveUserTimeZone(userId);
    const today = getTodayInTimeZone(timeZone);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const start = isDateKey(from) ? from : today;
    const end = isDateKey(to) && to >= start && to <= addDays(start, 31) ? to : addDays(start, 1);
    const prep = await getPrepSettings(userId);
    return NextResponse.json({ blocks: await getExternalBusyBlocks(userId, start, end, { timeZone, prep }) });
  } catch (err) {
    console.error("getExternalBusyBlocks failed", err);
    return NextResponse.json({ error: "Failed to load busy blocks" }, { status: 500 });
  }
}
