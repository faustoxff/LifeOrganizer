import "server-only";
import sql from "@/lib/db";
import { MAX_FACTS_PER_USER, type FactSource, type UserFact } from "@/lib/user-facts";

/**
 * Acceso a `user_facts`. Toda consulta filtra por `user_id`: el id de un hecho de otro
 * usuario no encuentra nada. Borrar es un DELETE: no queda ninguna marca ni copia.
 */

type FactRow = {
  id: string;
  key: string;
  value: string;
  source: FactSource;
  confidence: number;
  updated_at: string | Date;
};

const toFact = (row: FactRow): UserFact => ({
  id: row.id,
  key: row.key,
  value: row.value,
  source: row.source,
  confidence: Number(row.confidence),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
});

export async function listFacts(userId: string): Promise<UserFact[]> {
  const rows = await sql`
    SELECT id, key, value, source, confidence, updated_at
    FROM user_facts WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;
  return (rows as FactRow[]).map(toFact);
}

export type SaveFactResult =
  | { status: "saved"; fact: UserFact }
  /** Ya hay un hecho `stated` con esa clave y uno deducido no lo pisa. */
  | { status: "exists_stated" }
  | { status: "limit" };

/**
 * Guarda un hecho. Un `stated` pisa a cualquiera; un `inferred` solo entra si la clave no
 * existe o la que existe también es deducida. El tope se aplica a claves nuevas.
 */
export async function saveFact(
  userId: string,
  input: { key: string; value: string; source: FactSource; confidence: number }
): Promise<SaveFactResult> {
  const existing = await sql`SELECT source FROM user_facts WHERE user_id = ${userId} AND key = ${input.key}`;
  if (existing.length === 0) {
    const count = await sql`SELECT COUNT(*) AS count FROM user_facts WHERE user_id = ${userId}`;
    if (Number(count[0]?.count ?? 0) >= MAX_FACTS_PER_USER) return { status: "limit" };
  } else if (input.source === "inferred" && existing[0].source === "stated") {
    return { status: "exists_stated" };
  }

  const rows = await sql`
    INSERT INTO user_facts (id, user_id, key, value, source, confidence, updated_at)
    VALUES (${crypto.randomUUID()}, ${userId}, ${input.key}, ${input.value}, ${input.source},
            ${input.confidence}, NOW())
    ON CONFLICT (user_id, key) DO UPDATE
      SET value = EXCLUDED.value, source = EXCLUDED.source,
          confidence = EXCLUDED.confidence, updated_at = NOW()
    RETURNING id, key, value, source, confidence, updated_at
  `;
  return { status: "saved", fact: toFact(rows[0] as FactRow) };
}

/** El usuario editó el valor a mano: pasa a ser un hecho `stated`, dicho por él. */
export async function updateFactValue(userId: string, id: string, value: string): Promise<UserFact | null> {
  const rows = await sql`
    UPDATE user_facts
    SET value = ${value}, source = 'stated', confidence = 1, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, key, value, source, confidence, updated_at
  `;
  return rows[0] ? toFact(rows[0] as FactRow) : null;
}

export async function deleteFact(userId: string, id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM user_facts WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

export async function deleteAllFacts(userId: string): Promise<number> {
  const rows = await sql`DELETE FROM user_facts WHERE user_id = ${userId} RETURNING id`;
  return rows.length;
}
