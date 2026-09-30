import "server-only";
import sql from "@/lib/db";
import {
  parseAvailability,
  readAvailability,
  readOverrides,
  type Availability,
  type AvailabilityOverrides
} from "@/lib/availability";
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

export type AvailabilitySettings = {
  availability: Availability;
  overrides: AvailabilityOverrides;
  /** false = el usuario todavía no la configuró: se usa el default y se muestra el onboarding. */
  configured: boolean;
};

export async function getAvailabilitySettings(userId: string): Promise<AvailabilitySettings> {
  const rows = await sql`
    SELECT availability, availability_overrides FROM user_settings WHERE user_id = ${userId}
  `;
  const row = rows[0];
  return {
    availability: readAvailability(row?.availability),
    overrides: readOverrides(row?.availability_overrides),
    configured: parseAvailability(row?.availability) !== null
  };
}

/**
 * Guarda la disponibilidad. Es un upsert: si el usuario todavía no tiene fila en
 * user_settings (la zona horaria la crea en la primera carga) la crea, sin pisar
 * su zona.
 */
export async function saveAvailabilitySettings(
  userId: string,
  availability: Availability,
  overrides: AvailabilityOverrides
): Promise<void> {
  await sql`
    INSERT INTO user_settings (user_id, availability, availability_overrides)
    VALUES (${userId}, ${JSON.stringify(availability)}::jsonb, ${JSON.stringify(overrides)}::jsonb)
    ON CONFLICT (user_id) DO UPDATE
      SET availability = EXCLUDED.availability,
          availability_overrides = EXCLUDED.availability_overrides,
          updated_at = NOW()
  `;
}

/** Último día (en la zona del usuario) en que se replanificaron sus proyectos, o null. */
export async function getProjectsReplannedOn(userId: string): Promise<string | null> {
  const rows = await sql`
    SELECT projects_replanned_on::text AS day FROM user_settings WHERE user_id = ${userId}
  `;
  return (rows[0]?.day as string | undefined) ?? null;
}

export async function markProjectsReplanned(userId: string, today: string): Promise<void> {
  await sql`
    INSERT INTO user_settings (user_id, projects_replanned_on)
    VALUES (${userId}, ${today}::date)
    ON CONFLICT (user_id) DO UPDATE SET projects_replanned_on = EXCLUDED.projects_replanned_on
  `;
}
