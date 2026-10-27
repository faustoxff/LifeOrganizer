# Spark — Life Organizer

Organizador de tareas con IA para quien sabe qué hacer pero no logra empezar.
Spark elige una sola tarea, la divide en pasos de dos minutos y pone un temporizador.

## Qué hace

- **Recomendación del día**: cruza prioridad, vencimiento y duración con un puntaje
  determinístico y, según el plan, una capa de IA.
- **Dividir en pasos**: la IA convierte una tarea en 3–8 acciones concretas, la primera
  de menos de dos minutos.
- **Modo foco**: una tarea, un paso y un temporizador (10/25/45 min).
- **Milo**: asistente con chat, voz, búsqueda web y memoria de tus hábitos.
- **Captura rápida**: escribes el título y listo; el resto toma valores por defecto.
- **13 idiomas** con detección automática, e instalable en el celular (PWA).

## Stack

- **Next.js 15** + TypeScript + Tailwind
- **Clerk** — autenticación
- **Neon** (Postgres) — tareas, planes, memoria de Milo y contadores de uso
- **Groq** — modelos de lenguaje
- **Tavily / SearXNG** — búsqueda web
- **Paddle** — suscripciones y pagos (merchant of record)

## Correr localmente

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # pruebas de la lógica central
npm run build   # build de producción
```

## Variables de entorno

Copiá `.env.example` a `.env.local` y completá:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
DATABASE_URL=
GROQ_API_KEY=
TAVILY_API_KEY=            # opcional, búsqueda web del plan Pro
MP_ACCESS_TOKEN=           # opcional, suscripciones
NEXT_PUBLIC_MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET=         # requerido en producción
NEXT_PUBLIC_SITE_URL=      # dominio real en producción
```

## Base de datos

Ejecutá `neon/schema.sql` en el SQL Editor de Neon. Es idempotente
(`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), así que se puede
volver a correr cuando se agregan tablas o columnas.

## Estructura

- `app/` — páginas (landing pública en `/`, app en `/app`), rutas de API y legales.
- `components/` — interfaz. `calendar-view` y `focus-mode` son las principales.
- `lib/` — lógica pura y configuración: puntaje, fechas, límites de uso, textos.
- `tests/` — pruebas de la lógica que no depende del navegador ni de la red.

## Antes de publicar

1. Completar los datos del responsable en `lib/legal-config.ts` (CUIT, domicilio, email).
2. Revisión legal de `lib/legal-content.ts`.
3. Claves de producción de Clerk y Paddle, y credenciales propias de cada
   proveedor social.
4. Configurar el destino de notificaciones de Paddle en `/api/subscriptions/webhook`
   (`subscription.created`, `subscription.updated`, `subscription.canceled`)
   con el secret key como `PADDLE_NOTIFICATION_WEBHOOK_SECRET`.
