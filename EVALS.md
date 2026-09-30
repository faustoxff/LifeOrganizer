# Evals de Milo

Tests que corren contra el modelo real. Los unit tests de `tests/` solo prueban
que el parser lee un bloque bien formado; estos preguntan lo que importa: si Milo
entiende a una persona escribiendo entre clases, y si la respuesta deja alguna
incomodidad.

## Correr

```bash
npm run eval:milo                          # 58 casos × 2 modelos
npm run eval:milo -- --model default       # solo qwen (la mitad del costo)
npm run eval:milo -- --filter recurrencia  # un subconjunto
npm run eval:milo -- --repeat 5            # buscar casos intermitentes
npm run eval:milo -- --provider ollama     # medir el provider de pago
npm run eval:milo -- --mode legacy         # el camino viejo (bloque TASKS_ACTION), como línea base
npm run eval:milo -- --transcript /tmp/milo
```

Nunca corre con `npm test`: ese gate es hermético y no debe gastar ni un token.

Las opciones llegan por variables de entorno, no por `process.argv`. Vitest
rechaza opciones desconocidas antes de arrancar, y lo que pasa después de un `--`
no aparece en el `process.argv` del worker: el archivo leía los flags ahí y por
eso nunca vio ninguno. Toda corrida "filtrada" que se documentó en el pasado en
realidad corrió completa, con los dos modelos. `scripts/eval-milo.mjs` traduce el
CLI a `EVAL_*` y ahí está la única fuente de verdad.

## Qué cubre

| Grupo | Qué mira |
|---|---|
| `recurrencia` | gym miércoles y sábados, todos los lunes, todos los días |
| `explicito` | "agendame", "recordame", "creame una tarea" |
| `implicito` | menciona algo a hacer con fecha, sin fecha, y varios a la vez |
| `no-crea` | conceptos, charla, opiniones, alabanzas, "ya lo hice", desahogo |
| `free` | el plan Free no crea tareas y sí orienta al upgrade |
| `robustez` | mayúsculas, sin acentos, sin espacios, typos, emoji, mensaje largo |
| `semana` | "organizame la semana" con 5-8 cosas, recurrentes, un turno con hora, la semana que viene |
| `varias` | varias cosas en un mensaje: ninguna se pierde, cada una en su día |
| `ask_user` | falta un dato necesario → pregunta; si el resto está claro, propone sin preguntar |
| `agenda` | "¿qué tengo el jueves?" contesta con lo que hay, sin proponer nada |
| `cambio` | mover o sacar un ítem de una propuesta pendiente |
| `memoria` | guardar lo que el usuario dice de sí mismo (que es despistado, cuándo rinde) y **no** guardar salud, dinero, documentos ni un plan de pasada |
| `comfort` | largo de la respuesta, planes gigantes |
| `regresion` | los bugs que este harness encontró, para que no vuelvan |

### Dos caminos, una línea base

Desde la etapa 4 Milo llama tools (`create_items`, `plan_week`, `get_schedule`,
`ask_user`) y el harness corre el mismo camino que la ruta: tools cuando un proveedor
configurado las soporta, el bloque `TASKS_ACTION` si no. Los casos nuevos con
`toolsOnly` (los de `ask_user` y `semana`) se saltean en el camino de texto. Los demás
corren en los dos, y **para saber si tools empeoró algo hay que correr las dos
versiones y comparar**:

```bash
npm run eval:milo -- --mode legacy --model default   # línea base
npm run eval:milo -- --mode tools --model default    # el camino nuevo
```

`--mode tools` falla fuerte si ningún proveedor soporta tools, en vez de medir el otro
camino sin avisar. Las expectativas nuevas (`tool`, `askUser`, `distinctDays`,
`weekStart`) solo se miran con tools; `minTasks`, `titleOn`, `titleOnOrBefore` y
`mentions` valen en los dos.

Además hay tres chequeos de incomodidad que se aplican a **todos** los casos:

- `no-falsa-afirmacion` — el modelo decía "he creado la tarea" cuando nada se había
  creado todavía; el usuario después ve un botón de confirmar.
- `sin-tuteo` — la app es 100% voseo y el modelo se colaba con "¿quieres?".
- `sin-json-filtrado` — `{"title":"L` a medio escribir se veía en el chat.

`expectation.tasks: "none"` pesa tanto como `"some"`. Una tarea inventada cuando
alguien pregunta "¿qué es un simplex?" se siente peor que una tarea que no se crea.

## Cuánto cuesta

**El presupuesto de Groq son 200.000 tokens POR DÍA y POR MODELO.** No por minuto,
no por request: por día.

Un turno de chat consume:

| Parte | Tokens |
|---|---|
| Prompt (con las fechas ya resueltas y las reglas) | ~1.100-1.500 |
| Razonamiento (solo en el modelo Pro) | ~200-250 |
| Respuesta + bloque de tareas | ~300-500 |
| **Total** | **~1.500-1.900** |

Eso da **~120 turnos de chat por día, en total, para todo el producto** —sumando
todos los usuarios. Una corrida completa del eval son ~70 llamadas, o sea se
come la mitad del día.

Cuando se agota, el mensaje real de Groq lo dice sin rodeos:

```
Rate limit reached for model `qwen/qwen3.8-27b` ... on tokens per day (TPD):
Limit 200000, Used 199974, Requested 1460. Please try again in 10m19.488s.
```

Ojo con ese "10m19s": está calculado sobre el ritmo de consumo actual, no sobre
cuándo se reinicia la ventana diaria. Volver en ese plazo solo junta otro 429.
Por eso la cadena lo trata como piso y nunca como permiso.

## La cadena de providers

Groq primero porque es rápido y gratis mientras dure. Ollama Cloud segundo porque
no tiene techo diario. `lib/ai/complete.ts` es el único que llama a un provider.

| | Groq | Ollama Cloud |
|---|---|---|
| Techo | 200k tokens/día/modelo | ninguno |
| Costo | $0 hasta que se agota | $0.15/M entrada, **$0.014/M cacheada**, $0.60/M salida |
| Un turno medido | gratis | **$0.00024** |
| 200 turnos/día | gratis | **$1,44/mes** (~$0,72 fuera de pico) |

### El prompt partido, medido

Contra la API real, tres turnos seguidos con el prefijo partido:

```
turno 1: prompt 1188, cached    48   <- todavía no hay nada cacheado
turno 2: prompt 1188, cached 1152   <- 97% del prefijo
turno 3: prompt 1188, cached 1152
```

Eso baja el turno de **$0.000396 a $0.00024**, un 39%. La salida domina el
costo ($0.00022 de los $0.00024), así que cachear la entrada no compra tanto
como parece: lo que compra es que el precio ya no escala con el tamaño del
prompt.

`buildTaskPromptParts()` devuelve dos mitades en lugar de una:

- **static** (~842 tokens) — estilo, honestidad, voseo y las reglas de creación.
  Idéntica byte a byte para todos los usuarios del mismo plan.
- **dynamic** — fecha de hoy, tabla de fechas, memoria y tareas del usuario.
  Cambia en cada turno.

Estable primero es obligatorio: los providers que cachean por prefijo solo
reusan los bytes del principio, y un detalle por turno adelante de las reglas
las invalidaría todas. `tests/milo-prompt.test.ts` lo fija, incluida la
comprobación de que la mitad estática no cambia con las tareas ni con la memoria.

Una concesión, **solo en el camino de texto**: la mitad estática lleva una fecha, en el
ejemplo de formato del bloque `TASKS_ACTION`. (El prompt de tools no lleva ninguna: es
idéntico todos los días.) Podría ser un `YYYY-MM-DD` literal, pero eso invita al
modelo a emitirliteral como `dueDate` y crear tareas basura. Cuesta un
re-calentamiento de caché por día, que a $0.136/M de diferencia son centavos.

### El circuit breaker

Un provider caído es peor que ningún provider: contesta 429 en ~200ms, así que
sin cuarentena cada turno de cada usuario paga una ida y vuelta desperdiciada
antes de caer al siguiente. `lib/ai/circuit-breaker.ts` lo saca de rotación.

La política es **por tipo de fallo**, porque "umbral" y "cooldown" responden
preguntas distintas y una sola política para las dos se equivoca en una de ellas
para cada tipo:

| Fallo | Umbral | Cooldown | Por qué |
|---|---|---|---|
| `rate_limited` por día | 2 | 5 min → 10 min | Evidencia fuerte, y no se recupera en 30s |
| `rate_limited` por minuto | 2 | 30s → 2 min | Se limpia en segundos |
| `timeout` | **4** | 30s → 2 min | Evidencia débil: una respuesta lenta es una respuesta lenta |
| `server` / `network` | 3 | 30s → 5 min | Transitorio |
| `auth` | **1** | 10 min | Una key rota no se arregla reintentando |
| `bad_request` | — | — | Es nuestro bug, no del provider |

Los cuatro límites de Groq (TPM, RPM, TPD, RPD) llegan todos como
`Rate limit reached`. `rateLimitScope()` los separa leyendo el texto, porque la
diferencia entre "esperá 30s" y "esperá a mañana" no se puede adivinar.

El umbral de `timeout` es 4 y no 2 por un motivo concreto: `gpt-oss-120b` tarda
legítimamente cinco segundos, y dos respuestas lentas seguidas sacaban al único
provider configurado de rotación por treinta segundos.

### Si el primer provider no contesta

Los callers de texto corto y mecánico piden el tier `fast` explícitamente: el
resumen de memoria, la blurb de estadísticas, los pasos de una tarea, el
companion. En `fast` se manda `reasoning_effort: "none"`, que no es solo dinero:
la única vez que Milo mandó un chat en blanco fue porque el modelo se gastó los
1200 tokens razonando y devolvió `content: ""`.

El chat no adivina si un mensaje es simple. Un guess determinista de "esto es
complicado" es un guess, y equivocarse sale caro en calidad o en plata.

Cuando la respuesta viene vacía o cortada (`finish_reason === "length"`), se
reintenta una vez en el tier contrario **empezando por el provider siguiente**:
la respuesta enana es una propiedad del modelo, no de la pregunta, así que
reintentar contra el mismo motor la reproduce.

## Decisión pendiente

Resuelto: el techo ya no es un techo. Con `OLLAMA_API_KEY` en el entorno la
cadena pasa a un provider sin límite diario, así que dos o tres usuarios en
horario pico ya no pueden agotar el día. Falta la key (ver `DEPLOY.md`); sin ella
todo sigue en Groq y el mensaje amable es lo único que hay.

Lo que sigue abierto, en orden de valor:

1. **Parser de fechas y recurrencias en código, no en el prompt.** Un
   deterministic que resuelva "cada martes" y "en tres días" antes de llamar al
   modelo permitiría borrar la tabla de fechas del prompt (~150 tokens) y
   eliminar de raíz los errores de fecha, que son los que más incomodan.
2. **Routing por dificultad real.** Hoy el tier lo declara el caller. Cuando el
   parser del punto 1 exista, "esto es una tarea simple" pasa a ser una señal
   determinista en vez de un guess.
3. **Un fine-tune propio** sobre un modelo chico, que es la vía realista a "mi
   propia IA": no hay GPU en esta máquina (Ryzen 7 7445HS, 14GB, sin CUDA), así
   que servir un modelo capaz en local no es una opción.

Mientras tanto: usar `--model default` para las corridas de rutina, y reservar
`--repeat 5` para antes de un release.

### Estado: 72/72 contra Ollama

`npm run eval:milo -- --provider ollama` con `gpt-oss:120b` como **único** provider:
**72 de 72**, en 115 segundos, sin techo de por medio. Es la primera corrida
completa que llega de punta a punta; las de Groq siempre se cortaban a mitad de
camino por la cuota diaria.

Los 36 casos × 2 tiers dan lo mismo con un solo modelo, así que el comportamiento
de Milo no dependía de qué provider atendiera. Lo que cambia entre providers es
la latencia: **~1,2s de mediana** en Ollama contra **~530ms** en Groq para
`qwen/qwen3.8-27b`. Por eso Groq sigue primero en la cadena: es gratis mientras
dure, y cuando se va la diferencia de velocidad deja de importar.

## Bugs que encontró el harness de providers

Distinto de los de abajo: estos los encontró la cadena, no el comportamiento de
Milo.

8. **Retry que no cambiaba de modelo.** `order` se usaba como filtro en vez de
   como secuencia, así que el reintento tras una respuesta enana caía siempre en
   el mismo modelo que la había producido. Un no-op silencioso.
9. **Timeouts aislando al provider.** Umbral 2 para `timeout` sacaba a Groq de
   rotación con dos respuestas lentas seguidas, y una corrida completa de 68
   tests falló en 18 segundos. El breaker hacía lo que se le pedía; lo que se le
   pedía estaba mal.
10. **Un solo tipo de error para toda la cadena.** El route decidía entre "Milo
    está ocupado" y "no se pudo conectar" leyendo `error.status`, que el error
    de la cadena ya no expone. Ahora `ProviderError.kinds` trae el detalle de
    cada provider, y "ocupado" solo se afirma si *todos* fallaron por capacidad.
11. **Flags del harness que nunca se leyeron.** Ver arriba, en "Correr".

## Bugs que encontró

Cada uno está fijado como caso de regresión.

1. **Respuesta vacía.** El modelo Pro gastaba los 800 tokens en razonamiento y
   devolvía `content: ""`. El usuario veía un chat en blanco. Ahora `maxTokens`
   es 1200 y si la respuesta viene vacía o con `finish_reason === "length"` se
   reintenta con el otro modelo.
2. **Bloque cortado a la mitad.** Con recurrencias diarias el modelo emitía 28
   tareas, se pasaban del presupuesto y el array quedaba sin cerrar. El parser
   ahora descarta la cola sin cerrar en vez de mostrarla como prosa, y el prompt
   pide máximo 12.
3. **Fechas inventadas.** "Un parcial el jueves" en un lunes producía "el parcial
   es mañana". El modelo hacía la aritmética en su cabeza; ahora el prompt le
   pasa los días de la semana ya resueltos a fecha.
4. **Pregunta en vez de propuesta.** "¿Para qué día lo necesitás?" en vez de
   proponer con la fecha por default. El usuario no tenía tarea y no sabía por
   qué.
5. **Tarea inventada al preguntar el estado.** "¿Cómo voy con mis tareas?" le
   agregaba una tarea que no pidió y decía que la había creado.
6. **Falsa afirmación.** "Listo, agendado" / "he creado la tarea", cuando la
   tarea existe recién cuando el usuario confirma.
7. **Tuteo.** "¿Quieres?", "tienes", en una app que es toda voseo.

## Eval de proyectos (`npm run eval:projects`)

Juzga la calidad de lo que hace la IA en el flujo de proyectos, contra los modelos de
verdad. Igual que el de Milo, **no** entra en `npm test`: gasta dinero y depende de un
tercero.

```bash
npm run eval:projects                        # los 5 casos
npm run eval:projects -- --filter mudanza    # uno solo
npm run eval:projects -- --provider ollama   # medir un provider puntual
npm run eval:projects -- --transcript /tmp/proyectos   # guarda preguntas y subtareas
```

Los casos están en `evals/project-cases.ts`: un TP universitario con consigna, una mudanza,
preparar un parcial, organizar un evento y un proyecto vago donde preguntar es lo correcto.
Cada uno corre dos pruebas:

- **Preguntas**: cuántas hace (rango razonable por caso), que cada una explique por qué,
  que no se repitan y que al menos una toque lo que de verdad cambia el plan.
- **Subtareas**: que pase la validación (DAG, 10-240 min), que la primera se pueda arrancar
  hoy en ≤ 30 min sin dependencias, que ningún título sea vago ("Avanzar con el TP"), que haya
  una revisión final y un entregable, que cubra el proyecto entero, que ninguna se lleve casi
  todo el trabajo y que el scheduler, con la disponibilidad por defecto, lo haga entrar.

Al final imprime cuántos tokens gastó la corrida, para estimar el costo de un plan.

## Eval de checklists (`npm run eval:checklists`)

Juzga la calidad de lo que hace la IA en las checklists de "no te olvides", contra los modelos
de verdad. Como los otros, **no** entra en `npm test`.

```bash
npm run eval:checklists                        # los 4 casos de lista + la clasificación
npm run eval:checklists -- --filter gimnasio   # uno solo
npm run eval:checklists -- --provider ollama
npm run eval:checklists -- --transcript /tmp/checklists
```

Los casos están en `evals/checklist-cases.ts`:

- **Despistado va al gimnasio en invierno con lluvia**: la lista *de hoy* (la que sale de aplicar
  `selectItems` a la época y al clima) tiene agua, celular, abrigo y algo para la lluvia, y no tiene
  protector ni gorra; y la lista *guardada* trae el protector marcado como de verano, para otro día.
- **Correr en verano con calor**: agua y protector/gorra; nada de abrigo ni paraguas.
- **Pádel**: usa el hecho "juega al pádel" (paleta, pelotas).
- **Viaje, en inglés**: documentos, cargador y celular; el idioma sigue a la app.
- **Clasificación en lote**: gimnasio, dentista, clase de guitarra, peluquería y ajedrez son
  actividades; pagar la luz, llamar a mamá, entregar un TP, comprar leche y limpiar **no**. Un
  mandado marcado como actividad es el error caro (muestra una checklist donde no va), así que se
  reporta aparte.

En todos: ítems de hasta 6 palabras y 60 caracteres, ninguno sensible, y al menos uno con época o
clima (sin condicionales la lista es igual todos los días).

Los casos de `memoria` de `eval:milo` corren con la **verificación real del servidor** (la cita tiene
que estar en el mensaje y el filtro de sensibles): miden qué decide guardar el modelo y qué rechaza el
código. Son `toolsOnly`: en el camino de texto no hay `remember_fact`.
