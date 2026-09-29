# Roadmap de Spark

Este documento existe para que cualquier sesión futura (humana o de IA) tenga el
contexto de hacia dónde va el producto y qué decisiones ya están tomadas.

## Objetivos del producto

1. **Simplificar tareas complejas.** El usuario carga cualquier tarea con su info
   y archivos; la IA pide lo que falta y la divide en subtareas repartidas hasta la
   fecha límite, con margen.
2. **Milo organiza la semana con criterio humano.**
3. **Distinguir recordatorio / tarea / proyecto.** Cada uno se trata distinto en
   la UI, en el scheduler y en el prompt de Milo.
4. **Conocer al usuario y personalizar** (ej. el checklist del gimnasio).

## Etapas

1. **Modelo de datos** ← etapa actual (este documento describe su diseño).
2. Scheduler determinístico.
3. Flujo de proyecto (subtareas con IA + UI de proyectos).
4. Milo con tool calling y planificación semanal.
5. Memoria estructurada y checklists.

Google Calendar (importación y clasificación de eventos) queda para después.

---

## Etapa 1: diseño

### Tres tipos de tarea: `tasks.kind`

| kind       | Qué es                                      | Datos                                            |
|------------|---------------------------------------------|--------------------------------------------------|
| `reminder` | Acción puntual (< ~10 min)                  | Título + fecha + hora (`remind_at`). Sin pasos.  |
| `task`     | Entra en una sentada (hasta ~2-3 h)         | Usa los `steps` de siempre.                      |
| `project`  | Varios días hasta una fecha límite          | Tendrá filas en `subtasks` (etapa 3).            |

- Default de las filas existentes: `task`.
- `remind_at` guarda la hora local `HH:MM` (TEXT), que junto con `due_date` da el
  momento del recordatorio en la zona del usuario. No es un timestamp: la zona
  vive en `user_settings`, no en la fila.
- Clasificación al crear: `lib/task-kind.ts` → `suggestKind(input)`, función pura
  y sin IA. En el formulario el tipo son chips preseleccionados con la sugerencia
  y editables. Para recordatorio el formulario pide hora.
- Un proyecto se muestra como una tarea con un badge "Proyecto" hasta la etapa 3.
- Cambiar project → task solo cambia el `kind` (todavía no hay subtareas).
- Los proyectos **no** pueden ser recurrentes.

### Duración en minutos

- `tasks.estimate_min INTEGER`. Backfill desde `duration`: short=15, medium=45, long=120.
- El código usa `estimate_min`. La columna `duration` se mantiene por
  compatibilidad y se escribe derivada: `<=20` short, `<=75` medium, resto long.
- `getTaskScore` puntúa por minutos. El formulario ofrece 15/30/45/60/90/120+ min.

### Recurrencias: series + ocurrencias

Tabla `task_series` (`id, user_id, kind, title, category, description, priority,
estimate_min, time, rule JSONB, starts_on, ends_on, active, created_at`).

```json
{ "freq": "daily|weekly|monthly", "interval": 1,
  "weekdays": [3, 6], "monthDay": 31 }
```

JSON propio, **sin rrule.js**. `weekdays`: 0=domingo..6=sábado. Las semanas van de
lunes a domingo para calcular `interval` en `weekly`. `monthly` con `monthDay`
mayor que los días del mes cae en el último día del mes.

En `tasks`: `series_id`, `occurrence_date DATE`, `status ('pending'|'done'|'skipped')`.
Índice único `(series_id, occurrence_date) WHERE series_id IS NOT NULL`.
`done` se mantiene sincronizado con `status` (`done = status = 'done'`).

- `lib/recurrence.ts` (puro): `occurrencesBetween(rule, startsOn, endsOn, from, to)`.
- **Ventana móvil**: `ensureOccurrences(userId, today)` crea las ocurrencias que
  falten de hoy a hoy+14 días. Idempotente (`INSERT ... ON CONFLICT DO NOTHING`).
  Se llama al cargar las tareas del usuario.
- En esa misma carga, las ocurrencias con `occurrence_date < hoy` y `pending`
  pasan a `skipped`. Un `skipped` no aparece en "Hoy", no cuenta como vencido, no
  suma a la racha **y tampoco la corta**.
- **Editar / borrar una ocurrencia**: alcance "solo esta" (la fila) o "esta y las
  siguientes" (la serie vieja termina el día anterior vía `ends_on`, se crea una
  serie nueva desde esa fecha y se borran las ocurrencias futuras pendientes de la
  vieja).
- "Hoy" y la tarea recomendada solo consideran ocurrencias de hoy (o tareas
  normales). Las futuras se ven en el calendario. Los recordatorios no compiten
  como tarea recomendada: se muestran aparte ("Recordatorios de hoy").

### Zona horaria

`user_settings(user_id PK, timezone, updated_at)`. Se toma del navegador
(`Intl.DateTimeFormat().resolvedOptions().timeZone`) y viaja como `?tz=` en la
carga de tareas; el servidor la valida y la guarda si cambió. Todo "hoy" del
servidor se calcula con esa zona.

### Milo deja de expandir recurrencias

El bloque `TASKS_ACTION` acepta por ítem `kind`, `time` (`HH:MM`) y
`repeat { freq, interval?, weekdays?, monthDay?, until? }`. Con `repeat` el
servidor crea **una serie**, no N tareas. `normalizeTaskAction` valida `repeat`:
si es inválido se descarta el `repeat`, no el ítem. Las tareas ya existentes
creadas por expansión quedan como están.

### Esquema y migración

Todo en `neon/schema.sql`, idempotente. Tablas nuevas: `task_series`, `subtasks`
(solo creación en esta etapa), `user_settings`. Toda query nueva filtra por
`user_id` (hay tests de aislamiento que lo verifican leyendo el código).

`subtasks`: `id, project_id → tasks(id) ON DELETE CASCADE, user_id, title,
estimate_min, depends_on TEXT[], scheduled_date, position, done, done_at,
actual_min, created_at`.

### Límites

- El tope de Free (15 tareas) cuenta solo tareas sueltas (`series_id IS NULL`):
  las ocurrencias las genera el sistema, no el usuario. El tope duro de 1000 filas
  las cuenta a todas, y hay un máximo de 30 series activas por usuario.
