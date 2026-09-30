import "server-only";
import sql from "@/lib/db";
import { getTodayInTimeZone, isValidTimeZone } from "@/lib/task-date";

const DEFAULT_TIME_ZONE = "UTC";

/** La zona guardada del usuario, o null si todavía no se registró ninguna. */
export async function getUserTimeZone(userId: string): Promise<string | null> {
  const rows = await sql`SELECT timezone FROM user_settings WHERE user_id = ${userId}`;
  const zone = rows[0]?.timezone;
  return isValidTimeZone(zone) ? zone : null;
}

/**
 * Guarda la zona que reporta el navegador. Una sola consulta: si ya es la misma
 * no escribe nada (el WHERE del DO UPDATE lo evita), así que llamarla en cada
 * carga no genera escrituras.
 */
export async function saveUserTimeZone(userId: string, timeZone: string): Promise<void> {
  await sql`
    INSERT INTO user_settings (user_id, timezone)
    VALUES (${userId}, ${timeZone})
    ON CONFLICT (user_id) DO UPDATE
      SET timezone = EXCLUDED.timezone, updated_at = NOW()
      WHERE user_settings.timezone <> EXCLUDED.timezone
  `;
}

/**
 * Zona con la que el servidor calcula el "hoy" de este usuario. Si el
 * navegador mandó una válida se usa y se guarda; si no, la guardada; si no hay
 * ninguna, UTC.
 */
export async function resolveUserTimeZone(userId: string, reported?: unknown): Promise<string> {
  if (isValidTimeZone(reported)) {
    await saveUserTimeZone(userId, reported);
    return reported;
  }
  return (await getUserTimeZone(userId)) ?? DEFAULT_TIME_ZONE;
}

/** "Hoy" del usuario en su zona guardada. Para rutas que no reciben `tz`. */
export async function getUserToday(userId: string, now: Date = new Date()): Promise<string> {
  const zone = (await getUserTimeZone(userId)) ?? DEFAULT_TIME_ZONE;
  return getTodayInTimeZone(zone, now);
}
