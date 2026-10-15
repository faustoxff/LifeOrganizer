# Deploy a producción

Orden real, no el que parece. Cada paso depende del anterior.

## Antes: variables que NO son secretas

`NEXT_PUBLIC_*` se inlinean **en el bundle durante el build**. Si las cambiás después
en el panel, el bundle viejo sigue sirviendo el valor viejo hasta que rebuildees.
En Vercel esto es automático: cambiar la variable dispara un redeploy.

## Paso 1 — Deploy con las claves de Clerk que ya tenés

Las claves de desarrollo (`pk_test_` / `sk_test_`) **funcionan en producción**.
No son inseguras per se: lo que no hacen es escalar. La instancia dev tiene tope
de 100 usuarios y cookies de desarrollo.

Subí el repo a GitHub, importalo en Vercel Hobby, y configurá **todas** las
variables de `.env.example` (`.env.local` es gitignored, no se sube solo).

Al deploying tenés una URL pública HTTPS. **Ese es el objetivo de este paso.**

## Paso 2 — Paddle: webhook

Recién ahora, porque necesita la URL del paso 1. La guía completa (sandbox,
ngrok, tarjeta de prueba y checklist de producción) está en
[`docs/PADDLE.md`](docs/PADDLE.md). Resumen:

1. Corré la migración `neon/migrations/2026-10-paddle-subscription-columns.sql`
   (primero en una branch de Neon).
2. Paddle → **Developer tools → Notifications → New destination**
3. URL: `https://<tu-dominio>/api/subscriptions/webhook`
4. Eventos: `subscription.created`, `subscription.updated`,
   `subscription.canceled`, `subscription.past_due` y `transaction.completed`
   (la guía lista también `activated`, `paused`, `resumed` y `trialing`)
5. Te devuelve una **secret key** → `PADDLE_WEBHOOK_SECRET`

Sin la secret key la ruta responde 500 y Paddle reintenta: se cobra la plata pero
el plan no se activa hasta que la variable exista. Con una firma inválida responde
401.

## Paso 3 — Probá un pago (sandbox primero)

Esto es lo que valida el circuito de cobro. Nadie lo puede hacer por vos.

1. Entrá a la app con una cuenta de prueba
2. `/plans` → elegir Pro → checkout
3. Pagá con la tarjeta de prueba de Paddle (ver `docs/PADDLE.md`)
4. Esperá el webhook
5. Verificá en la base que `user_plans` tenga `plan = 'pro'` y
   `paddle_status = 'active'`

Si el plan aparece, el circuito está cerrado. Si la fila no cambió, el webhook no
llegó: revisá el secret y que la URL sea exacta (sin slash al final, sin `www` si
el dominio no lo tiene).

## Paso 4 — Clerk a producción (obligatorio antes de vender)

La instancia de desarrollo no sirve para público: tope de 100 usuarios y
cookies que no son de producción.

1. Dashboard de Clerk → **Create application** → Spark (production)
2. **Instances → Add instance → Development**, luego configurá la de producción
3. Dominio: agregá el tuyo y verificá la propiedad por DNS
4. Traé `pk_live_` / `sk_live_` a Vercel y rebuildea

**Chequeo de seguridad:** en `app/api/subscriptions/webhook/route.ts`, si
`PADDLE_WEBHOOK_SECRET` falta la ruta devuelve 500. Confirmá que en Vercel la
variable existe con mayúsculas exactas.

## AI: el segundo provider (recomendado antes de tener usuarios)

Groq es rápido y gratis, pero su plan da **200.000 tokens por día por modelo para
toda la cuenta**. Medido contra el tráfico real, eso son ~130 turnos de chat en
todo el producto. El día que se agota, todos los usuarios reciben el mismo error
al mismo tiempo.

La app ya no depende de eso: hay una cadena en `lib/ai/complete.ts` que cae a
Ollama Cloud cuando Groq no puede. Para activarla alcanza con una variable:

1. Registrate en <https://ollama.com> y creá una key en
   <https://ollama.com/settings/keys>
2. `OLLAMA_API_KEY` en Vercel (y en `.env.local` para desarrollo)
3. Redeploy

Sin la key, todo sigue funcionando igual: un provider sin key se saltea solo y
no se pierde nada. **El plan Pro de $20/mes de Ollama no hace falta para
arrancar**; agrega créditos, no cuota. Compralo solo si el uso real lo pide.

Sin esto, el único síntoma es el mensaje "Milo está con muchos mensajes ahora",
que es honesto pero no evita nada.

### Si la key quedó mal

Un `401` manda al provider a cuarentena por 10 minutos de una, sin reintentos: una
key rota no se arregla probando de nuevo. El estado se ve en los logs:

```
[ai] skipping "ollama": quarantined after earlier failures
```

Un lambda que ya estaba caliente conserva la cuarentena; uno nuevo arranca limpio.

### Fijar un provider

`AI_PROVIDER_ORDER=groq,ollama` (el default). `AI_PROVIDER_ORDER=ollama` deja
Groq completamente afuera, útil para comparar comportamiento sin que el fallback
esconda un problema.

## Lo que sigue después

Nada de esto es bloqueante para cobrar, pero es lo que convierte usuarios en
clientes: emails transaccionales (bienvenida, trial por vencer) y analytics.
