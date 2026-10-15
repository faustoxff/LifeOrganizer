-- Paddle Billing: columnas para guardar la suscripción en user_plans.
--
-- ADITIVA y re-ejecutable:
--   * solo ADD COLUMN IF NOT EXISTS, todas NULLABLE y sin DEFAULT -> no reescribe
--     la tabla ni toca ninguna fila existente;
--   * no borra ni cambia mp_preapproval_id, mp_payer_email, subscription_status
--     ni ningún CHECK (los usuarios actuales siguen funcionando igual);
--   * no migra datos.
--
-- Cómo correrla (primero en una branch de Neon):
--   psql "$DATABASE_URL_BRANCH" -v ON_ERROR_STOP=1 -f neon/migrations/2026-10-paddle-subscription-columns.sql
-- o pegala en el SQL Editor de la consola de Neon (branch de prueba).
--
-- Seguridad: esta app usa Neon + Clerk, no Supabase, así que no hay RLS ni rol
-- "authenticated". El navegador nunca habla con la base: solo las rutas del
-- servidor (DATABASE_URL) leen y escriben user_plans, y cada lectura filtra por
-- el user_id de la sesión de Clerk.

BEGIN;

-- Id del cliente en Paddle (ctm_...). Hace falta para abrir el portal de cliente.
ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT;

-- Id de la suscripción en Paddle (sub_...).
ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT;

-- Estado tal cual lo manda Paddle: active | trialing | past_due | paused | canceled.
-- Va aparte de subscription_status (authorized/paused/cancelled, heredado de
-- Mercado Pago, con su CHECK) para no tocar ese constraint.
ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS paddle_status TEXT;

-- Price id (pri_...) de la suscripción: define el plan y deja la puerta abierta
-- a precios nuevos (anual) sin tocar el esquema.
ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS paddle_price_id TEXT;

-- Fin del período facturado actual. Un past_due sigue siendo Pro hasta esta fecha.
ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- true si el usuario canceló y conserva el plan hasta current_period_end.
-- NULL se lee como false.
ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN;

-- occurred_at del último evento de Paddle aplicado. Sirve para ignorar un evento
-- viejo que llega después de uno más nuevo (Paddle no garantiza el orden).
ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS paddle_event_at TIMESTAMPTZ;

-- Una suscripción de Paddle pertenece a una sola cuenta. UNIQUE común: Postgres
-- permite varias filas con NULL (los usuarios sin suscripción de Paddle).
CREATE UNIQUE INDEX IF NOT EXISTS user_plans_paddle_subscription_id_key
  ON user_plans (paddle_subscription_id);

COMMIT;

-- Verificación (debería devolver 7 filas, todas nullable = YES):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'user_plans'
--     AND column_name IN ('paddle_customer_id','paddle_subscription_id','paddle_status',
--       'paddle_price_id','current_period_end','cancel_at_period_end','paddle_event_at');
--
-- Rollback (solo si hiciera falta; descarta lo que el webhook haya guardado):
--   BEGIN;
--   DROP INDEX IF EXISTS user_plans_paddle_subscription_id_key;
--   ALTER TABLE user_plans
--     DROP COLUMN IF EXISTS paddle_customer_id,
--     DROP COLUMN IF EXISTS paddle_subscription_id,
--     DROP COLUMN IF EXISTS paddle_status,
--     DROP COLUMN IF EXISTS paddle_price_id,
--     DROP COLUMN IF EXISTS current_period_end,
--     DROP COLUMN IF EXISTS cancel_at_period_end,
--     DROP COLUMN IF EXISTS paddle_event_at;
--   COMMIT;
