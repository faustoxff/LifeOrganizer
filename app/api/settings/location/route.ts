import "server-only";
import { NextResponse } from "next/server";
import { authenticate, badRequest, readBody } from "@/lib/checklist-route";
import { clearApproxLocation, getApproxLocation, saveApproxLocation } from "@/lib/user-settings";
import { roundCoordinate, validCoordinates } from "@/lib/weather";

// GET /api/settings/location — la ubicación aproximada guardada, o null.
export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ location: await getApproxLocation(auth.userId) });
  } catch (error) {
    console.error("[location] get failed", error);
    return NextResponse.json({ error: "Failed to load location" }, { status: 500 });
  }
}

// PUT /api/settings/location — { lat, lon }. Se guarda REDONDEADA a 0,1° (~10 km): el servidor
// nunca conserva la ubicación exacta que mandó el navegador.
export async function PUT(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const body = await readBody(request);
  if (!body || !validCoordinates(body.lat, body.lon)) return badRequest("lat and lon must be valid coordinates");
  const location = { lat: roundCoordinate(body.lat as number), lon: roundCoordinate(body.lon as number) };
  try {
    await saveApproxLocation(auth.userId, location);
    return NextResponse.json({ location });
  } catch (error) {
    console.error("[location] save failed", error);
    return NextResponse.json({ error: "Failed to save location" }, { status: 500 });
  }
}

// DELETE /api/settings/location — la borra.
export async function DELETE() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    await clearApproxLocation(auth.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[location] clear failed", error);
    return NextResponse.json({ error: "Failed to delete location" }, { status: 500 });
  }
}
