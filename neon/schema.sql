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

-- ---------------------------------------------------------------------------
-- Roadmap etapa 3: flujo de proyectos (ver docs/roadmap.md)
-- ---------------------------------------------------------------------------

-- Resumen del texto de los archivos que el usuario adjunto. Los archivos en si no
-- se guardan.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS context_summary TEXT;

-- La IA marca los entregables; not_before difiere una subtarea salteada.
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS deliverable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS not_before DATE;

-- Sesiones que produce el scheduler. Una subtarea puede tener varias (subtasks
-- solo guarda la fecha de la primera). Se guardan porque replan las necesita como
-- plan anterior para no mover lo ya agendado.
CREATE TABLE IF NOT EXISTS project_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  project_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id  TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  minutes     INTEGER NOT NULL CHECK (minutes > 0),
  part        INTEGER NOT NULL CHECK (part > 0),
  total_parts INTEGER NOT NULL CHECK (total_parts > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subtask_id, date)
);

CREATE INDEX IF NOT EXISTS project_sessions_user_date_idx ON project_sessions (user_id, date);
CREATE INDEX IF NOT EXISTS project_sessions_project_idx ON project_sessions (project_id);

-- Ultimo dia (en la zona del usuario) en que se replanificaron sus proyectos.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS projects_replanned_on DATE;

-- Tokens por llamada de IA de proyectos, para poder medir el costo por plan.
CREATE TABLE IF NOT EXISTS ai_token_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_token_log_user_idx ON ai_token_log (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Roadmap etapa 5: memoria estructurada y checklists (ver docs/roadmap.md)
-- ---------------------------------------------------------------------------

-- Hechos que el usuario dice de si mismo. Una fila por (usuario, clave). Borrar es un
-- DELETE real: no hay marca de "borrado".
CREATE TABLE IF NOT EXISTS user_facts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  value      TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 200),
  source     TEXT NOT NULL CHECK (source IN ('stated', 'inferred')),
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS user_facts_user_idx ON user_facts (user_id);

-- La lista de "no te olvides" de una actividad. `series_id` liga la lista a una serie
-- (por ejemplo, el gimnasio de los martes); sin serie es la lista de la actividad.
-- items: [{text, uses, skips, lastUsedAt, season?, weather?}]
CREATE TABLE IF NOT EXISTS activity_checklists (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  activity_key TEXT NOT NULL,
  series_id    TEXT REFERENCES task_series(id) ON DELETE CASCADE,
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_checklists_uniq
  ON activity_checklists (user_id, activity_key, COALESCE(series_id, ''));
CREATE INDEX IF NOT EXISTS activity_checklists_user_idx ON activity_checklists (user_id);

-- Que actividad es un titulo, por usuario. activity_key '' = "no es una actividad": evita
-- volver a preguntarle a la IA por el mismo titulo.
CREATE TABLE IF NOT EXISTS activity_titles (
  user_id      TEXT NOT NULL,
  title_norm   TEXT NOT NULL,
  activity_key TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, title_norm)
);

-- La checklist de esa ocurrencia: la lista del dia, el clima que se uso y el estado de cada item.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checklist JSONB;

-- Ubicacion aproximada (redondeada a 0,1 grados, unos 10 km). Solo sirve para el clima.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS approx_lat REAL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS approx_lon REAL;

-- Etapa 6: lo que pasa con cada tarea. Todo aditivo.
--  * actual_min: minutos reales (solo si se hizo con el modo foco; NULL = no se sabe).
--  * completed_hour: hora LOCAL del usuario (0-23) al completar.
--  * postponed_count / last_postponed_at: cuántas veces se movió a un día posterior.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_min INTEGER
  CHECK (actual_min IS NULL OR actual_min > 0);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_hour SMALLINT
  CHECK (completed_hour IS NULL OR completed_hour BETWEEN 0 AND 23);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS postponed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_postponed_at TIMESTAMPTZ;

ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS completed_hour SMALLINT
  CHECK (completed_hour IS NULL OR completed_hour BETWEEN 0 AND 23);
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS postponed_count INTEGER NOT NULL DEFAULT 0;

-- Etapa 7: margen antes de un compromiso (viaje, prepararse). NULL = el default (15 min para
-- eventos de calendario, 0 para recordatorios y tareas con hora).
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS prep_calendar_min SMALLINT
  CHECK (prep_calendar_min IS NULL OR prep_calendar_min BETWEEN 0 AND 240);
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS prep_reminder_min SMALLINT
  CHECK (prep_reminder_min IS NULL OR prep_reminder_min BETWEEN 0 AND 240);

-- Etapa 8: fecha planificada vs fecha límite. due_date es SIEMPRE la fecha límite; planned_on es
-- "cuándo hacerla" cuando la replanificación la movió (NULL = el día que vence). pinned: no se mueve nunca.
-- replan_conflict: no entra antes de su fecha límite (se ofrecen correr la fecha o más minutos por día).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_on DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS replan_conflict BOOLEAN NOT NULL DEFAULT FALSE;

-- Lo que el replan movió, para contárselo al usuario y poder deshacerlo (por ítem).
CREATE TABLE IF NOT EXISTS replan_moves (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  task_id               TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  from_date             DATE NOT NULL,
  to_date               DATE NOT NULL,
  prev_planned_on       DATE,
  prev_postponed_count  INTEGER NOT NULL DEFAULT 0,
  moved_on              DATE NOT NULL,
  seen                  BOOLEAN NOT NULL DEFAULT FALSE,
  undone                BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS replan_moves_user_idx ON replan_moves (user_id, seen);
