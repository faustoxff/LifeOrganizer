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

1. **Modelo de datos** (hecha).
2. **Scheduler determinístico** (hecha).
3. **Flujo de proyecto** ← etapa actual (diseño al final de este documento).
3b. (sin cambios más abajo) (subtareas con IA + UI de proyectos).
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

- El tope de Free (15) cuenta las tareas sueltas (`series_id IS NULL`) **más una por
  cada serie activa**, sin importar cuántas ocurrencias genere: las ocurrencias las
  crea el sistema, no el usuario, y una serie diaria no debería bloquear al usuario
  por dos semanas.
- Hay un máximo de 30 series activas por usuario (todos los planes) y el tope duro de
  1000 filas cuenta también las ocurrencias.
- Las ocurrencias `skipped` y las ya hechas no se purgan todavía. Con series diarias
  acumulan filas hacia el tope de 1000: una limpieza periódica queda pendiente.

### Decisiones de la etapa 1

- Borrar "solo esta" ocurrencia la marca `skipped` en vez de borrar la fila: si se
  borrara, la fecha caería dentro de la ventana y `ensureOccurrences` la volvería a
  crear.
- "Esta y las siguientes" solo se ofrece sobre una ocurrencia pendiente, y no permite
  cambiar la regla ni la fecha: para eso se crea una serie nueva.
- Proyecto ↔ tarea: una ocurrencia no puede pasar a proyecto (los proyectos no se repiten).
- Milo solo ve en su prompt las ocurrencias de hoy, no las futuras. La planificación
  semanal con las series completas llega en la etapa 4.

---

## Etapa 2: scheduler determinístico

Código puro y con tests exhaustivos. **La IA nunca decide fechas**: la IA (etapa 3)
dice qué subtareas hay y cuánto duran; el scheduler decide cuándo.

### Disponibilidad del usuario

- `user_settings.availability JSONB`: minutos por día de la semana (0 = domingo),
  ej. `{"0":60,"1":120,...,"6":180}`. `NULL` significa "todavía no configurada" y
  dispara el paso corto del onboarding; el código usa el default mientras tanto:
  lunes a viernes 120, sábado 180, domingo 60.
- `user_settings.availability_overrides JSONB`: `{ "YYYY-MM-DD": minutos }` para
  excepciones ("el viernes no puedo" = 0). Un override **reemplaza** el valor del día
  de la semana, no se suma.
- `tasks.daily_cap_min` (`NULL` = sin tope propio): tope diario de un proyecto.
- UI: ajustes de disponibilidad con un slider por día, y el mismo diálogo como paso
  de onboarding si no está configurada. Todavía no hay UI de proyectos.

### `lib/scheduler.ts`

Puro: sin DB, sin `Date.now()`; todo entra por parámetro. `schedule(input) → output`.

Entrada: `today`, `availability`, `overrides`, `projects` (con `deadline`,
`dailyCapMin?` y subtareas con `estimateMin`, `dependsOn`, `done`, `actualMin?`),
`fixedLoad` (minutos ya ocupados por fecha) y `params` (`inflation` 1.3,
`targetFraction` 0.85, `maxSessionMin` 90, `minSessionMin` 20).

1. Se valida que las dependencias formen un DAG. Un ciclo lanza un error explícito
   (`SchedulerCycleError`, `code: "CYCLE"`), igual que una dependencia inexistente.
2. Duración efectiva = `ceil(estimateMin * inflation)`. Lo hecho no se agenda. Si una
   subtarea sin terminar ya tiene `actualMin`, se le descuenta.
3. Fecha objetivo = `today + floor((deadline - today) * targetFraction)`, y nunca
   después de `deadline - 1` si faltan al menos 2 días.
4. **Holgura CPM** medida en minutos de capacidad acumulada (no en días): así es
   comparable entre proyectos. `holgura = latestStart - earliestStart`, con el
   `latestStart` calculado hacia atrás desde la capacidad acumulada hasta la fecha
   objetivo. Es estática: se calcula una vez desde hoy.
5. **Relleno hacia adelante** día por día. Capacidad del día = `override ??
   availability[dow]` menos `fixedLoad`. Entre las subtareas disponibles se elige la de
   menor holgura; desempate: deadline más cercano, después orden original. Una subtarea
   está disponible cuando todas sus dependencias están hechas o agendadas por completo
   en días **anteriores** (un sucesor empieza el día después, no el mismo día).
6. Sesiones: a lo sumo una por subtarea y por día, de hasta `maxSessionMin`. Al partir
   una subtarea, ninguna sesión queda por debajo de `minSessionMin` salvo la última
   (el resto se rebalancea para que la última no quede diminuta). `part`/`totalParts` se
   asignan al final, ordenadas por fecha.
7. Nada en días pasados. Hoy usa la capacidad que queda: quien llama descuenta lo ya
   trabajado hoy en `fixedLoad`.
8. El trabajo nunca se agenda después del `deadline` (el día del deadline sí se usa).

Salida: `sessions`, `perProject` (`feasible`, `plannedEndDate`, `bufferDays`,
`shortfallMin`, `bufferConsumedPct`, y si no es factible, `options`) y `warnings`
(`INFEASIBLE`, `TIGHT`, `OVERLOADED_DAY`, `CYCLE`).

`bufferConsumedPct` = qué parte del margen entre la fecha objetivo y el deadline ya se
gastó (0 si termina antes del objetivo, 100 si no es factible).

**Si no entra no se inventa un plan imposible**: se devuelve lo que sí entra antes del
deadline, `feasible = false`, `shortfallMin` y `options` calculadas re-planificando:
`extraMinPerDay` (minutos extra por día que harían falta, sumados solo a los días que
ya tienen disponibilidad: un día en 0 sigue en 0; `null` si ni con 24 h por día
alcanza, p. ej. una cadena de dependencias más larga que los días) y `achievableDeadline` (la fecha más cercana que sí alcanzaría
con la disponibilidad actual, o `null`).

`OVERLOADED_DAY` avisa de un día donde la carga fija ya supera la disponibilidad.

### Replanificación

`replan(input, previous?)` usa `schedule` con el estado actual. Lo no hecho de días
pasados vuelve a entrar desde hoy, porque las sesiones pasadas se descartan y lo que
falta se calcula de la duración efectiva menos `actualMin`. Quien llama es responsable
de sumar a `actualMin` el trabajo que el usuario hizo.

Es **estable**: mismo input, mismo output. Las sesiones de hoy en adelante del plan
anterior se conservan (se "clavan") mientras sigan siendo válidas —hay capacidad, se
respeta el tope del proyecto y el orden de dependencias— y el resto se planifica
alrededor. Si clavarlas deja a algún proyecto peor que un plan nuevo desde cero, gana
el plan nuevo. Devuelve además `newlyInfeasible` y `newlyTight` para alertar cuando
`feasible` pasa a `false` o `bufferConsumedPct` supera 50 (`TIGHT`).

### Aprendizaje del factor de inflación

`lib/estimate-learning.ts`: mediana de `actualMin / estimateMin` del historial del
usuario, acotada entre 1.0 y 2.0, con un mínimo de 5 muestras; si no alcanzan, 1.3.

---

## Etapa 3: flujo de proyectos

El flujo completo usando el scheduler: cargar → entender y preguntar → dividir →
vista previa → confirmar → día a día. **La IA propone qué subtareas hay y cuánto
duran; nunca decide fechas** (eso es `schedule()`).

### Carga

Al elegir el tipo Proyecto en el formulario (solo Plus/Pro; en Free el chip aparece
bloqueado con un enlace a /plans) se piden título, descripción libre, fecha límite y
archivos opcionales.

- **Archivos**: PDF, DOCX, TXT y MD. **No se guardan**: se extrae el texto en el servidor
  (`unpdf` para PDF, `mammoth` para DOCX) en `POST /api/projects/extract`, un archivo por
  request, y se guarda solo un resumen en `tasks.context_summary`.
- **Límites**: 3 archivos por proyecto y **4 MB** por archivo. No son los 10 MB del ejemplo
  original: Vercel corta cualquier request de más de 4.5 MB antes de que llegue a la
  función, así que un límite mayor solo produciría errores opacos.
- **Texto largo**: si un archivo supera ~12 000 caracteres se resume por partes (mapa →
  resumen final) con el modelo rápido antes de guardarlo. El contexto total queda en
  ≤ 6 000 caracteres.
- **Imágenes**: quedan afuera. Ningún proveedor configurado en `lib/ai/providers` tiene
  visión (`supportsVision` es `false` en ambos) y los mensajes son solo texto. La UI lo
  dice. Cuando haya un proveedor con visión se implementa el envío de imágenes y se
  cambia la bandera.

### Entender y preguntar — `POST /api/projects/intake`

La IA recibe título, descripción, fecha límite, resumen de archivos, disponibilidad y
la fecha de hoy. Devuelve JSON validado:
`{ understanding, questions: [{ id, text, why, type: "text"|"choice"|"number", options? }] }`.
Máximo 5 preguntas y solo las que cambian el plan; `questions = []` si no hace falta
ninguna. JSON inválido: un reintento con el error y después falla con un mensaje claro.

### Dividir — `POST /api/projects/plan`

La IA devuelve `subtasks: [{ tempId, title, estimateMin, dependsOn[], deliverable? }]`.
Reglas del prompt: 4–25 subtareas concretas y verificables; la primera se puede empezar
hoy en menos de 30 minutos; incluir revisión final y margen para imprevistos. El servidor
valida (JSON, DAG sin ciclos, estimaciones de 10 a 240 min, ids únicos y existentes), reintenta
una vez con el error y luego falla. Después corre `schedule()` con el factor de inflación
aprendido del usuario.

Modelo: un tier nuevo `planner` (`GROQ_PLANNER_MODEL`, `OLLAMA_PLANNER_MODEL`, por defecto el
modelo `pro`) para que dividir un proyecto grande pueda usar más capacidad que el chat.

### Vista previa y confirmación

- `POST /api/projects/preview` recalcula el plan sin IA (para ediciones del usuario).
- Si `feasible = false` se muestra **antes** de confirmar con las opciones: más minutos por
  día (suma a la disponibilidad, y lo dice), correr la fecha, o recortar alcance (borrar
  subtareas hasta cubrir el faltante).
- Al confirmar (`POST /api/projects`) el servidor **recalcula** el plan (no confía en las
  sesiones del cliente) y guarda todo.

### Modelo de datos

- `tasks.context_summary`; `subtasks.deliverable`, `subtasks.not_before`.
- **`project_sessions`**: el scheduler produce sesiones (una subtarea puede tener varias) y
  `subtasks.scheduled_date` es solo la fecha de la primera. Las sesiones se guardan porque
  `replan` las necesita como plan anterior para no mover lo ya agendado.
- `user_settings.projects_replanned_on`: marca "ya se replanificó hoy" (por usuario).
- `ai_token_log`: tokens por llamada de IA de proyectos, para medir el costo.

### Día a día

- "Hoy" muestra las sesiones de proyectos del día (proyecto, progreso X/Y) junto con las tareas.
- Completar una subtarea registra `actual_min`: el tiempo del modo foco si se usó el
  temporizador; si no, se pregunta "¿cuánto tardaste?" con opciones o se saltea.
- Acciones sobre una sesión: **completar** la subtarea, **hice esta parte** (suma minutos sin
  terminarla) y **saltear** (`not_before = mañana`: la subtarea se difiere; el scheduler ya
  entiende `notBefore`).
- Se replanifica una vez por día por usuario, al cargar la app, y al completar o saltear.
  Como `replan` es estable y lo hace el servidor, es idempotente.
- `fixedLoad` sale de las tareas normales pendientes (`estimate_min` en su fecha; lo vencido
  cuenta hoy). Las sesiones de proyecto no cuentan como carga fija.
- Con `TIGHT` o `INFEASIBLE` aparece un aviso con acciones concretas (correr la fecha,
  sumar minutos por día, ver el plan).
- Detalle del proyecto: plan completo por día, progreso y margen restante.
- Completar todas las subtareas completa el proyecto. Las subtareas hechas cuentan para la
  racha.

### Plan, límites y costos

Crear un proyecto y todo lo que usa IA es Plus/Pro. Kinds nuevos en `lib/usage-limits.ts`:
`project_intake` y `project_plan` (Free 0). Replanificar y avanzar un proyecto ya creado es
determinista, no gasta IA y no se bloquea. Cada llamada de IA de proyectos guarda sus tokens
en `ai_token_log` y los deja en el log del servidor.
