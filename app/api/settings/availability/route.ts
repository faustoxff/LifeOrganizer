import "server-only";
import { NextResponse } from "next/server";
import { parseAvailability, parseOverrides } from "@/lib/availability";
import { requireAuth } from "@/lib/server-auth";
import { getAvailabilitySettings, saveAvailabilitySettings } from "@/lib/user-settings";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// GET /api/settings/availability — minutes per weekday, date exceptions, and
// whether the user has configured it yet (drives the onboarding step).
export async function GET() {
  let userId: string;
  try { userId = await requireAuth(); }
  catch { return unauthorized(); }

  try {
    return NextResponse.json(await getAvailabilitySettings(userId));
  } catch (err) {
    console.error("getAvailabilitySettings failed", err);
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
  }
}

// PUT /api/settings/availability — { availability, overrides? }
export async function PUT(request: Request) {
  let userId: string;
  try { userId = await requireAuth(); }
  catch { return unauthorized(); }

  const body = (await request.json().catch(() => null)) as
    | { availability?: unknown; overrides?: unknown }
    | null;

  // Anything malformed is rejected whole: a half-saved availability would read as
  // "0 minutes" on the days that are missing.
  const availability = parseAvailability(body?.availability);
  const overrides = parseOverrides(body?.overrides);
  if (!availability || !overrides) {
    return NextResponse.json({ error: "Invalid availability" }, { status: 400 });
  }

  try {
    await saveAvailabilitySettings(userId, availability, overrides);
    return NextResponse.json({ availability, overrides, configured: true });
  } catch (err) {
    console.error("saveAvailabilitySettings failed", err);
    return NextResponse.json({ error: "Failed to save availability" }, { status: 500 });
  }
}
