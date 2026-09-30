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
3. **Flujo de proyecto** (hecha).
4. **Milo con tool calling y planificación semanal** (hecha).
5. **Memoria estructurada y checklists** ← etapa actual (diseño al final de este documento).

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

### Decisiones de la etapa 3

- **Un archivo por request**: el asistente sube los archivos de a uno (`/api/projects/extract`),
  cada uno con su parte del presupuesto de contexto. El resumen se guarda; el archivo no.
- **`unpdf` y `mammoth`** se verificaron dentro del build de producción de Next, no solo en tests.
- **Las opciones de un plan que no entra** salen del scheduler (`extraMinPerDay`,
  `achievableDeadline`, faltante). "Más minutos por día" **se guarda en la disponibilidad
  del usuario** al confirmar (sumado a cada día que ya tenía tiempo), y la pantalla lo dice;
  "correr fecha" cambia `due_date` del proyecto; "recortar alcance" es borrar subtareas y
  recalcular.
- **Confirmar recalcula en el servidor** y nunca usa las sesiones que mande el cliente. Se puede
  confirmar un plan que no entra (queda un aviso permanente), pero la pantalla lo muestra antes.
- **Saltear = diferir a mañana** (`not_before`). Terminar la última subtarea termina el proyecto.
- **Tope de 15 proyectos activos** por usuario, para todos los planes.
- **Free**: el chip Proyecto queda bloqueado con enlace a /plans; ver y avanzar lo que ya existe
  (completar, saltear, correr fecha) no se bloquea porque es determinista y no gasta IA.
- **Racha**: un día con una subtarea de proyecto terminada cuenta (cliente y `/api/stats`).
- **Las sesiones de proyecto compiten en la recomendación de IA** como tareas pendientes
  (`session:<id>`), con prioridad alta si el plan viene TIGHT o INFEASIBLE.
- **Duración de las llamadas**: `maxDuration = 60` en extract, intake y plan. Dividir un proyecto
  grande puede tardar; el plan de Vercel Hobby limita a 60 s.

---

## Etapa 4: Milo con tools y planificación semanal

Hasta acá Milo escribía un bloque `TASKS_ACTION:[...]` al final de su texto y un parser lo
rescataba. Funciona, pero el modelo tiene que acordarse de un formato, el texto y la acción
viajan mezclados, y no hay forma de que consulte nada. Ahora Milo llama a **tools**; el
servidor las valida y las ejecuta. **El modelo nunca escribe en la base**: `create_items` y
`plan_week` solo *proponen*, y crear sigue siendo el botón de confirmar de siempre.

### Capa de IA (`lib/ai/`)

- `ToolSpec`, `ToolCall`, mensajes `assistant` con `toolCalls` y `tool` con el resultado
  (`AgentMessage`). El formato de cable es el de OpenAI (`lib/ai/tool-wire.ts`), que hablan
  Groq y Ollama Cloud; los dos adaptadores lo usan.
- Cada adaptador dice, **por modelo**, si soporta tools (`supportsTools(model)`). Groq sí
  (`GROQ_TOOLS=off` lo apaga). Ollama solo con modelos `gpt-oss` (`OLLAMA_TOOLS=on|off` fuerza).
- `complete({ tools })` salta los proveedores sin soporte (no cuentan como falla para el
  breaker). Si no queda ninguno falla como `bad_request`.
- **Fallback**: si ningún proveedor configurado soporta tools, o si todos rechazan la
  request con `bad_request`, el chat usa el camino de antes: prompt con `TASKS_ACTION` y
  `parseTaskActions`. Ese parser y ese texto del prompt solo viven en ese camino.

### Tools de Milo (`lib/milo-tools.ts`)

Solo para Plus/Pro. En Free Milo no tiene tools (igual que hoy no crea nada).

| Tool | Qué hace | Efecto |
|---|---|---|
| `create_items({items})` | valida y normaliza cada ítem (`normalizeTaskAction`: kind, hora, `repeat`) | propone: el chat muestra los ítems para confirmar |
| `plan_week({items, weekStart?})` | corre `lib/week-planner.ts` con la disponibilidad y la agenda real | propone una distribución por día con una razón por ítem |
| `get_schedule({from, to})` | tareas, ocurrencias, sesiones de proyecto y capacidad libre por día | solo lectura; vuelve al modelo |
| `ask_user({question})` | corta el turno con esa pregunta | Milo responde con la pregunta |

- Cada tool valida sus argumentos en el servidor (fechas reales, tope de ítems, largos) y
  devuelve un error legible al modelo si algo no cuadra, para que corrija. Nada se
  ejecuta con argumentos que no parsean.
- Todo dato viene de la base filtrado por `user_id`: el ejecutor se arma con el usuario
  autenticado y **no hay ningún argumento del modelo que elija de quién son los datos**.
  Lo que manda el cliente (`tasks`) alimenta el prompt, no las tools.
- Un turno es un bucle de hasta 4 rondas modelo → tools → modelo. Cuenta como **un** uso de
  `milo_chat`, igual que hoy. La última ronda va con `tool_choice: none` para que escriba
  la respuesta.
- `create_items`: hasta 20 ítems por llamada. Una recurrencia es un ítem con `repeat`.

### `plan_week`: criterio humano (`lib/week-planner.ts`)

Puro (sin base ni reloj), determinístico. Reusa del scheduler la **capacidad por día**
(`capacityOn`) y la **duración efectiva** (`effectiveMinutes`, con el factor aprendido del
usuario). No usa `schedule()` para colocar porque esos ítems son atómicos: el scheduler
parte y encadena subtareas de un proyecto, acá una tarea de 60 min no se corta en dos.

Ítem **fijo**: trae `dueDate` (o `time`): va ese día. Ítem **flexible**: sin fecha, se reparte
en la semana; puede traer `deadline` (no después de). Una recurrencia cae en los días que
su regla marca dentro de la semana.

1. **Admisión**: qué entra se decide por prioridad y fecha contra el espacio libre total de
   la semana (capacidad menos lo ya agendado). Lo que no entra se *difiere*.
2. **Colocación**, de la ventana más angosta a la más ancha, día por día con un puntaje:
   - No entra en la capacidad del día → descartado.
   - **Dos pesadas el mismo día** (`estimateMin >= 90`, o prioridad alta con `>= 60`) → penalización
     fuerte. Cuenta también lo ya agendado.
   - **Más del 85 %** de la capacidad del día, habiendo otro con lugar → penalización fuerte.
   - **Día liviano**: se reserva el día con menos carga; solo se usa si no hay otro lugar.
   - **Parejo**: menor ocupación resultante y menos ítems ese día. Empate: el día más temprano.
3. **No entra todo**: lo diferido sale con la sugerencia de pasarlo a la semana siguiente,
   en orden de prioridad y fecha, y el planificador lo dice (no inventa días imposibles).
4. Cada ítem colocado lleva una **razón estructurada** (`FIXED`, `RECURRING`, `BEST_FIT`,
   `HEAVY_CLASH`, `OVER_CAP`, `KEEP_LIGHT`, `BUSIER`, `DEADLINE`) con los datos (día descartado, minutos ya
   agendados, título de lo que ya había). El texto sale de `lib/i18n.ts`, así la tarjeta
   sale en el idioma del usuario y a Milo le llega en español para que la cuente.
5. Avisos: día sobrecargado por fechas fijas, semana sin día liviano, deadline en riesgo.

### Proponer, cambiar, confirmar

- La propuesta llega al chat como tarjeta: lista por día con la razón y, si los hay, los
  diferidos. Botones **Crear** y **Descartar**. Crear usa el flujo de siempre
  (`onCreateTask`, con sus límites de plan).
- **Cambios por chat**: el cliente manda de vuelta los ítems pendientes de confirmar
  (`pendingTaskActions`); van al prompt y Milo vuelve a llamar la tool con la lista
  completa y el cambio. La propuesta nueva reemplaza a la anterior.
- `pendingTaskAction` (uno) pasa a ser una lista: la confirmación ya manejaba varios ítems, lo
  que faltaba era que el modelo supiera de todos.

### Prompt (`lib/milo-chat-prompt.ts`)

Reescrito para tools: cuándo usar cada una, que incluya **todos** los ítems del mensaje,
`repeat` para lo recurrente, preguntar solo lo imprescindible (y con `ask_user`, no
inventando). Sin ningún rastro de `TASKS_ACTION`. Ese formato queda en un modo `legacy`
del mismo módulo, que solo se usa en el fallback.

### Decisiones de la etapa 4

- **Free no tiene tools**; los límites de `milo_chat` no cambian y un turno con varias rondas
  cuenta como **un** uso.
- **`plan_week` es para ítems nuevos.** Lo que el usuario ya tiene en su lista cuenta como
  agendado (carga fija de cada día) y el prompt le pide a Milo que no lo repita.
- **Sin `weekStart`, `plan_week` planifica los próximos 7 días desde hoy** (no la semana
  calendario). Para "la semana que viene" Milo pasa el lunes que viene, que está en su tabla de
  fechas.
- **Un proyecto no entra en `plan_week`** (se rechaza con el motivo): se arma desde el asistente.
- **Duración de los ítems nuevos**: se infla con el factor aprendido del usuario solo si hay
  historial suficiente; sin él se usa la estimación tal cual, en vez de aplicar el 1,3 por
  defecto de los proyectos a tareas sueltas. Lo ya agendado cuenta sin inflar.
- **Criterios en escalones** (pesadas > tope del 85 % > día liviano > parejo), más un desempate
  leve por "mejor antes que después" (`EARLY_BIAS`): con capacidades parecidas, el martes le gana al
  sábado. El día liviano puede usarse hasta el 50 % de su capacidad sin dejar de serlo, y se
  rompe antes que pasarse del 85 % en otro día.
- **`get_schedule`** conoce las ocurrencias de recurrentes que ya están generadas (ventana de
  14 días) y lo dice cuando el rango la pasa. No genera ocurrencias: no escribe.
- **Si falla una ronda después de haber propuesto algo**, la propuesta se devuelve igual con un
  texto por defecto.
- **Fallo parcial al confirmar**: lo que sí se creó no se vuelve a ofrecer (antes, reintentar
  duplicaba las que ya existían).
- **Interruptores**: `GROQ_TOOLS=off` y `OLLAMA_TOOLS=on|off` mandan el chat al camino de texto sin
  tocar código.

---

## Etapa 5: Spark conoce al usuario

Dos piezas que se alimentan entre sí: una **memoria estructurada** (hechos que el usuario
dice de sí mismo) y **checklists de "no te olvides"** por actividad que aprenden de lo que el
usuario usa. El resumen de `user_memory` sigue como está.

### Memoria estructurada: `user_facts`

`(id, user_id, key, value, source 'stated'|'inferred', confidence, updated_at)`, única por
`(user_id, key)`. `key` es `snake_case` (`es_despistado`, `horario_mejor_rendimiento`, `deportes`),
`value` una línea de hasta 200 caracteres, hasta 50 hechos por usuario.

- **Milo los guarda con la tool `remember_fact`**, y solo dos caminos:
  - `stated`: el usuario lo dijo. La tool exige `quote`, las palabras textuales del usuario, y el
    servidor comprueba que **aparezcan en el mensaje actual**. Sin eso no se guarda: es la
    forma de que "solo lo que dijo explícitamente" no dependa de la buena voluntad del modelo.
  - `inferred`: lo dedujo Milo. **No se guarda**: vuelve al chat como una propuesta con
    Guardar / No, y recién al confirmar se escribe (con `source = 'inferred'`).
- Un hecho `stated` nunca lo pisa uno `inferred`. Si el usuario edita un hecho a mano, pasa a `stated`.
- **Datos sensibles: no se guardan.** `lib/sensitive.ts` rechaza en el servidor (en la tool, en la
  API y al editar) salud, finanzas, identificadores (documentos, tarjetas, mails, teléfonos,
  contraseñas) y creencias, política u orientación. Es una lista de palabras en varios idiomas:
  atrapa lo obvio, no es un clasificador. Por eso hay tres capas: el prompt le dice a Milo que no
  los proponga, el servidor los rechaza, y la pantalla deja borrar todo.
- **Pantalla "Lo que Spark sabe de vos"** (`/knowledge`): cada hecho con su origen, editar y borrar;
  las listas aprendidas por actividad, con borrar; la ubicación aproximada, con borrar. **Borrar
  es un `DELETE` real**, sin marca de "borrado".
- Milo recibe los hechos **relevantes**, no todos: los que comparten palabras con la conversación
  y las tareas, más un núcleo chico (`es_despistado`, `horario_mejor_rendimiento`). Van en el
  bloque dinámico del prompt, marcados como datos del usuario y no como instrucciones.
- Free no tiene tools, así que no guarda hechos por chat. Los hechos y las listas son Plus/Pro.

### Checklists por actividad: `activity_checklists`

`(id, user_id, activity_key, series_id NULL, items JSONB)` con
`items = [{text, uses, skips, lastUsedAt, season?, weather?}]`.

- **`activity_key`** normalizado: minúsculas, sin acentos, sin espacios (`gimnasio`). El catálogo
  (`lib/activity.ts`) reconoce por reglas: gimnasio, correr, deporte, pileta, playa, yoga,
  facultad, trabajo, viaje y médico, con sus palabras en varios idiomas.
- **Detección**: reglas primero; lo que no reconocen, en **una sola llamada de IA barata (tier
  `fast`) por lote** de hasta 15 títulos, con caché por usuario y título (`activity_titles`, que
  también guarda "esto no es una actividad" para no reintentar). Sin activity, sin checklist.
- **Lista de un usuario**: la de la serie si la hay (`series_id`), si no la de la actividad. Una
  lista nace ligada a la serie cuando viene de una serie.
- **Primera vez**: la IA propone la lista con los hechos del usuario, la **época del año** (el
  hemisferio sale de la zona horaria: `lib/season.ts`) y, si hay ubicación aproximada, el **clima
  del día** de Open-Meteo (gratis, sin API key; fallo o sin ubicación = se omite el clima). Marca
  los ítems condicionales con `season` (`summer`/`winter`) o `weather` (`rain`/`cold`/`hot`).
- **Ubicación**: opcional, la da el usuario con un botón, se guarda **redondeada a 0,1°** (~10 km)
  y se borra desde la pantalla. Solo sirve para el clima.
- **Snapshot por ocurrencia** (`tasks.checklist`): la lista de ese día, con el clima que se usó y
  el estado de cada ítem (tildado, sacado). Se arma al primer uso.
- **Selección** (`selectItems`, pura): ítems sin condición ordenados por uso; los de `season` solo
  en esa época, los de `weather` solo con ese clima; los que se saltaron 3 veces seguidas ya no
  están; hasta 10.
- **Aprendizaje**, al completar la tarea/ocurrencia (`mergeLearning`, pura):
  - lo que sigue en la lista: `uses + 1`, `skips = 0`, `lastUsedAt`;
  - lo que el usuario sacó con la ✕ ("hoy no lo necesito"): `skips + 1`; con **3 seguidos**
    desaparece de la lista guardada;
  - lo que agregó a mano: entra (o suma) `uses` **al momento de agregarlo**, y no se cuenta dos veces
    al completar.
  No se aprende de una ocurrencia salteada ni de una tarea que nunca se completó.
- **Avisos**: la checklist aparece dentro de la tarea/ocurrencia y en una notificación **antes de
  la hora** (`lib/use-reminders.ts`; 10, 30 o 60 minutos, por defecto 30). Con el hecho
  `es_despistado` el aviso está activo por defecto; si no, la checklist ofrece activarlo. Solo
  funciona con Spark abierto, como el resto de los avisos.

### Milo y las recomendaciones

Si la conversación (o las tareas de esa semana) menciona una actividad con lista guardada, el
prompt de Milo incluye esos ítems para que pueda decir "acordate de llevar…". La recomendación
del día recibe el hecho `horario_mejor_rendimiento`.

### Planes, límites y costos

Detectar por IA (`checklist_detect`: Plus 10/día, Pro 30) y armar una lista inicial
(`checklist_generate`: Plus 20, Pro 60) son Plus/Pro y cuentan en `ai_token_log`. Aprender,
tildar y editar no gastan IA. Si la IA falla, la checklist queda vacía y el usuario la arma a
mano: nada se inventa.

### Modelo de datos (migración aditiva)

`user_facts`, `activity_checklists`, `activity_titles`, `tasks.checklist` y
`user_settings.approx_lat/approx_lon`. Todo con `IF NOT EXISTS`.

### Decisiones de la etapa 5

- **Free no tiene checklists ni hechos por chat** (las dos usan IA o tools). Ver y borrar lo que Spark
  sabe siempre se puede, sea cual sea el plan: los datos son del usuario.
- **`remember_fact` es la única tool que escribe**, y lo hace bajo condiciones que comprueba el servidor:
  filtro de sensibles, y para `stated` que su `quote` esté en el mensaje actual. Hasta 3 por mensaje.
  No hay tool para borrar: borrar es de la pantalla.
- **Los hechos entran al prompt como datos, no como instrucciones**: una línea, sin saltos, dentro del
  bloque dinámico. Un hecho con "ignorá las reglas" no puede cambiar el prompt fijo (que además no
  lleva nada del usuario).
- **Semántica de la ✕**: "hoy no lo necesito". Lo que queda cuenta como usado al completar la
  tarea; lo que se saca suma un "sacado". Se aprende **solo al completar**, una vez por ocurrencia
  (`learnedAt`); una tarea salteada no enseña nada.
- **Lo que se agrega a mano** entra a la lista guardada al momento (con un uso) y no se cuenta de nuevo al
  completar.
- **Una serie usa su lista, si no la de la actividad; una tarea suelta usa la que haya de esa
  actividad** (el gimnasio de los martes y "ir al gimnasio" hoy son lo mismo). Una serie nunca usa la
  lista de otra serie.
- **Detección**: caché por usuario y título → reglas → un lote de IA. Se detecta sobre las tareas de los
  próximos 7 días, y solo el cliente lo pide (una vez por tarea y sesión). El descarte del usuario ("esto
  no es una actividad") le gana a las reglas. Un mandado ("llamar al médico") nunca es actividad.
- **Sin cuota o con la IA caída**, la checklist queda vacía y el usuario la arma a mano; no se guarda
  nada, así que se reintenta después.
- **La ubicación la da el usuario** con un botón (geolocalización del navegador) y se guarda redondeada
  a 0,1° en el servidor; el servidor nunca conserva la exacta. Sin ubicación, sin clima: se omite.
- **Aviso previo**: solo funciona con Spark abierto (como los otros avisos), por la Notification API, sin
  push del servidor. El permiso se pide aparte del aviso diario.
- **Orden de despliegue**: `loadTasks` ahora lee `tasks.checklist`, así que la migración tiene que
  aplicarse **antes** de desplegar; con el código nuevo y el esquema viejo, cargar las tareas falla.

## Etapa 6: Spark aprende del usuario y se adapta al momento

Hasta acá Spark usaba un factor de inflación global y descartaba lo que pasaba con cada tarea. Esta
etapa guarda lo que pasa (cuánto tardó, a qué hora se terminó, cuántas veces se postergó) y lo usa.
**Todo es estadística sobre los datos del propio usuario: no hay IA generativa en el cálculo.** La IA
(Milo) solo redacta números que salen de `lib/user-patterns.ts`.

### 1. Guardar lo que pasa (migración aditiva)

- `tasks`: `actual_min INTEGER NULL`, `completed_hour SMALLINT NULL` (0-23, hora **local del
  usuario** al completar), `postponed_count INTEGER NOT NULL DEFAULT 0`, `last_postponed_at
  TIMESTAMPTZ NULL`.
- `subtasks`: `completed_hour` y `postponed_count`.
- Completar desde el modo foco guarda `actual_min` con los minutos reales del timer, **acumulando** si se
  hizo en varias sesiones (como `subtasks.actual_min`). Completar sin modo foco guarda solo
  `completed_hour` y deja `actual_min` en NULL: no se inventa.
- `postponed_count` sube cada vez que una tarea pasa a un **día posterior**. La regla es una sola
  (`isPostponement`, `lib/postponement.ts`) y la usan la edición a mano, Milo (que edita por la misma ruta)
  y `moveTaskDueDate`, la función que va a usar la replanificación del próximo prompt. Adelantar una tarea
  no es postergarla.

### 2. Modo foco solo donde tiene sentido

Solo para `kind = 'task'` con más de 15 min, y para las sesiones de subtareas de proyecto. Nunca para
`reminder` ni para tareas de 15 min o menos: esas se completan con un tilde (`lib/focus-eligibility.ts`).

### 3. Aprendizaje (`lib/user-patterns.ts`, funciones puras)

- `learnInflationByCategory(history)`: mediana de real/estimado por categoría, mismo criterio que
  `learnInflation` (mínimo 5 muestras, acotado 1.0-2.0). Categoría con pocas muestras → factor global;
  sin global → default (1.3). Cada resultado dice de dónde salió (`category` / `global` / `default`).
- `productiveHours(history)`: tareas completadas por franja (mañana 6-12, tarde 12-19, noche 19-24,
  madrugada 0-6). Solo "aprendida" con **15** completadas o más; con un empate en el primer puesto no
  se nombra una mejor franja.
- `chronicPostponers(history)`: una tarea que se postergó 3+ veces; una categoría con 3+ postergaciones
  repartidas en al menos 2 tareas (una sola tarea terca ya figura como tarea).
- El historial es de los **últimos 90 días** y se arma por usuario en el servidor
  (`lib/user-history.ts`), con un loader memoizado por request. Toda consulta filtra por `user_id`.

### 4. Usarlo

- El scheduler de proyectos y `plan_week` usan el factor de la **categoría** de cada tarea/proyecto.
- El formulario de tarea muestra la estimación ajustada: "Estimaste 30 min; en Estudio solés tardar ~45".
- Tool nueva de Milo, `get_my_patterns` (solo lectura): devuelve los patrones aprendidos para contestar
  "¿cuánto tardo en estudiar?" o "¿cuándo rindo más?".
- Pantalla de stats: sección "Cómo trabajás" con los mismos datos, o cuántas tareas faltan para
  empezar a aprender.

### Decisiones de la etapa 6

- El factor global ahora se calcula sobre tareas y subtareas con tiempo medido (antes, solo subtareas).
- Una tarea completada con tilde no aporta al factor (no hay tiempo real), pero sí a "cuándo rendís".
- Solo cuentan `task` y subtareas para las franjas; un recordatorio tildado no es trabajo.
- **Orden de despliegue**: aplicar la migración **antes** de desplegar; completar una tarea ahora escribe
  las columnas nuevas.
