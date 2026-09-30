-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  duration    TEXT NOT NULL DEFAULT 'medium' CHECK (duration IN ('short', 'medium', 'long')),
  due_date    TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id);

-- User plans table (free, plus or pro)
CREATE TABLE IF NOT EXISTS user_plans (
  user_id                TEXT PRIMARY KEY,
  plan                   TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'pro')),
  trial_ends_at          TIMESTAMPTZ,
  mp_preapproval_id      TEXT,
  mp_payer_email         TEXT,
  subscription_status    TEXT CHECK (subscription_status IN ('authorized', 'paused', 'cancelled')),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Milo's per-user memory: a short AI-generated summary of patterns/preferences,
-- refreshed periodically instead of storing full conversation history.
CREATE TABLE IF NOT EXISTS user_memory (
  user_id       TEXT PRIMARY KEY,
  summary       TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily AI usage counters, used to rate-limit Milo and other AI endpoints per user.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL,
  day     DATE NOT NULL DEFAULT CURRENT_DATE,
  kind    TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);

-- Sub-steps for a task (AI-generated "break it down" checklist).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]';

-- ---------------------------------------------------------------------------
-- Roadmap etapa 1 (ver docs/roadmap.md). Todo es aditivo e idempotente: se puede
-- correr N veces, y el codigo viejo sigue funcionando contra este esquema porque
-- cada columna nueva tiene default.
-- ---------------------------------------------------------------------------

-- Tipo de tarea: recordatorio (puntual), tarea (una sentada) o proyecto (varios dias).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'task'
  CHECK (kind IN ('reminder', 'task', 'project'));

-- Hora local 'HH:MM' del recordatorio; junto con due_date da el momento en la
-- zona del usuario (ver user_settings).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_at TEXT
  CHECK (remind_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Duracion en minutos. `duration` (short/medium/long) se conserva por
-- compatibilidad y el codigo la escribe derivada de este valor.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_min INTEGER;
UPDATE tasks
SET estimate_min = CASE duration WHEN 'short' THEN 15 WHEN 'medium' THEN 45 ELSE 120 END
WHERE estimate_min IS NULL;
ALTER TABLE tasks ALTER COLUMN estimate_min SET DEFAULT 45;
ALTER TABLE tasks ALTER COLUMN estimate_min SET NOT NULL;

-- Series recurrentes. Una fila por serie; las ocurrencias son filas de `tasks`
-- que se materializan en una ventana movil (lib/series-storage.ts).
CREATE TABLE IF NOT EXISTS task_series (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('reminder', 'task')),
  title        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  description  TEXT NOT NULL DEFAULT '',
  priority     TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  estimate_min INTEGER NOT NULL DEFAULT 45,
  time         TEXT CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  rule         JSONB NOT NULL,
  starts_on    DATE NOT NULL,
  ends_on      DATE,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_series_user_active_idx ON task_series (user_id, active);

-- Ocurrencias: la serie a la que pertenecen, su fecha y su estado. `done`
-- sigue siendo la fuente para stats y racha, asi que se mantiene sincronizado
-- con status ('done' <=> done = TRUE).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS series_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS occurrence_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'done', 'skipped'));
UPDATE tasks SET status = 'done' WHERE done = TRUE AND status = 'pending';

-- Es lo que hace idempotente a la materializacion: la misma ocurrencia no se
-- puede crear dos veces aunque dos requests corran a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_series_occurrence_uniq
  ON tasks (series_id, occurrence_date) WHERE series_id IS NOT NULL;

-- Subtareas de un proyecto. En la etapa 1 solo existe la tabla; el flujo de IA
-- y la UI llegan en la etapa 3.
CREATE TABLE IF NOT EXISTS subtasks (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  title          TEXT NOT NULL,
  estimate_min   INTEGER,
  depends_on     TEXT[] NOT NULL DEFAULT '{}',
  scheduled_date DATE,
  position       INTEGER NOT NULL DEFAULT 0,
  done           BOOLEAN NOT NULL DEFAULT FALSE,
  done_at        TIMESTAMPTZ,
  actual_min     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subtasks_project_idx ON subtasks (project_id);
CREATE INDEX IF NOT EXISTS subtasks_user_id_idx ON subtasks (user_id);

-- Zona horaria por usuario. Todo "hoy" calculado en el servidor usa esta zona.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT PRIMARY KEY,
  timezone   TEXT NOT NULL DEFAULT 'UTC',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Roadmap etapa 2: scheduler (ver docs/roadmap.md)
-- ---------------------------------------------------------------------------

-- Minutos disponibles por dia de la semana ({"0":60,"1":120,...,"6":180}, 0 =
-- domingo). NULL = todavia no configurada: la app usa el default y muestra el
-- paso de onboarding.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS availability JSONB;

-- Excepciones por fecha { "YYYY-MM-DD": minutos }; reemplazan al valor del dia.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS availability_overrides JSONB NOT NULL DEFAULT '{}';

-- Tope diario propio de un proyecto. NULL = sin tope propio.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS daily_cap_min INTEGER
  CHECK (daily_cap_min IS NULL OR daily_cap_min BETWEEN 1 AND 1440);
