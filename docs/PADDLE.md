# Paddle Billing: cobro de suscripciones

Spark cobra con **Paddle Billing** (no Paddle Classic). Paddle es el *Merchant of
Record*: vende la suscripción, cobra, calcula y remite los impuestos, y emite el
recibo. Todo apunta a **sandbox por defecto** (`NEXT_PUBLIC_PADDLE_ENV=sandbox`).

> Los pasos del dashboard de abajo se escribieron sin poder abrir
> developer.paddle.com (el entorno donde se desarrolló lo bloquea). Los nombres de
> menús y permisos están marcados **(verificar)** donde no pude confirmarlos: si
> algo no coincide, manda la documentación actual de Paddle.

## Cómo funciona

```
/plans ── "Suscribirme" ──► Paddle.js overlay (token público + custom_data.user_id)
                                      │ pago
Paddle ── webhook firmado ──► POST /api/subscriptions/webhook
                                      │ verifica firma (401 si falla)
                                      ▼
                        user_plans (Neon)  ◄── solo el servidor escribe
                                      │
        getUserPlan() → resolveUserPlan() ◄── única regla de acceso (API + UI)
```

- **El acceso Pro lo da solo el webhook verificado.** El cliente cierra el overlay
  y muestra un mensaje; nada más.
- `lib/subscription-plans.ts` → `resolveUserPlan`: `active`/`trialing` siempre;
  `past_due` solo hasta `current_period_end`; `paused`/`canceled` nunca. Una
  cancelación a fin de período deja el estado en `active` (con
  `cancel_at_period_end = true`) hasta que Paddle manda `subscription.canceled`.
- Eventos: `subscription.created|updated|canceled|past_due` (más `activated`,
  `paused`, `resumed`, `trialing`) y `transaction.completed` (relee la suscripción
  desde la API). Idempotente y tolerante a eventos fuera de orden (`occurred_at`).
- Los IDs de producto/precio van en variables de entorno, nunca en el código.
  Para sumar un precio anual: ver `lib/paddle-config.ts`.

## 1. Migración de la base (antes que nada)

La migración es **aditiva** (siete columnas nullable + un índice único; no toca
`mp_preapproval_id` ni migra datos). Correla primero en una branch de Neon:

```bash
psql "$DATABASE_URL_DE_LA_BRANCH" -v ON_ERROR_STOP=1 \
  -f neon/migrations/2026-10-paddle-subscription-columns.sql
```

El archivo trae la consulta de verificación y el rollback al final. Cuando la
branch esté bien, correla igual en la base principal **antes** de desplegar el
código: el código nuevo lee esas columnas.

## 2. Crear productos y precios en el sandbox

1. Cuenta sandbox: <https://sandbox-vendors.paddle.com> (es independiente de la
   cuenta live; nada se comparte).
2. **Catalog → Products → New product** (verificar): crea dos productos
   - `Spark Plus`, precio **recurrente mensual** de **USD 6.00**
   - `Spark Pro`, precio **recurrente mensual** de **USD 20.00**

   Sin período de prueba en Paddle: la prueba de 14 días de Plus la maneja la app,
   sin tarjeta.
3. Copia el **Price ID** de cada uno (`pri_...`).

## 3. Credenciales del sandbox

**Developer tools → Authentication** (verificar):

| Qué | Variable | Dónde va |
|---|---|---|
| API key (`pdl_sdbx_apikey_...`) | `PADDLE_API_KEY` | solo servidor |
| Client-side token (`test_...`) | `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | público |

La API key necesita permisos de **lectura** de suscripciones, precios y vista
previa de precios, y de **escritura** de sesiones del portal de cliente
(verificar los nombres exactos; es lo que usan `/api/paddle/portal`,
`/api/paddle/prices` y el webhook).

Además, en **Checkout → Checkout settings** (verificar) define el **Default
payment link** como `http://localhost:3000/plans` (local) o la URL de tu preview.
Paddle.js lo exige para abrir el overlay.

## 4. Webhook en local (ngrok)

```bash
npm run dev                     # http://localhost:3000
ngrok http 3000                 # copia la URL https://xxxx.ngrok-free.app
```

**Developer tools → Notifications → New destination** (verificar):

- URL: `https://xxxx.ngrok-free.app/api/subscriptions/webhook`
- Tipo: webhook
- Eventos: `subscription.created`, `subscription.updated`, `subscription.canceled`,
  `subscription.past_due`, `subscription.activated`, `subscription.paused`,
  `subscription.resumed`, `subscription.trialing`, `transaction.completed`
- Al guardar, Paddle muestra la **secret key** del destino → `PADDLE_WEBHOOK_SECRET`.
  Cada destino tiene la suya: el del sandbox no sirve en producción ni al revés.

`.env.local` (ver `.env.example`):

```
PADDLE_API_KEY=pdl_sdbx_apikey_...
PADDLE_WEBHOOK_SECRET=pdl_ntfset_...
NEXT_PUBLIC_PADDLE_ENV=sandbox
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_...
NEXT_PUBLIC_PADDLE_PRICE_PLUS=pri_...
NEXT_PUBLIC_PADDLE_PRICE_PRO=pri_...
```

Reinicia `npm run dev` después de tocar las `NEXT_PUBLIC_*`.

## 5. Probar con tarjeta de prueba

1. Entra con una cuenta de prueba → `/plans` → **Suscribirme** (Pro).
2. En el overlay usa la tarjeta de prueba de Paddle: **4242 4242 4242 4242**,
   cualquier vencimiento futuro, CVC **100** (verificar en la lista de tarjetas de
   prueba de Paddle; ahí hay también una para pagos rechazados).
3. El overlay se cierra y aparece "¡Pago recibido, gracias!". En segundos el
   badge pasa a Pro.
4. Verifica en la base:

   ```sql
   SELECT plan, paddle_status, paddle_subscription_id, current_period_end,
          cancel_at_period_end, paddle_event_at
   FROM user_plans WHERE user_id = '<tu clerk id>';
   ```

   Esperado: `plan = 'pro'`, `paddle_status = 'active'`.
5. **Ajustes → Suscripción → Administrar suscripción** abre el portal de Paddle.
   Cancela desde ahí: `cancel_at_period_end` pasa a `true` y el plan sigue Pro
   hasta `current_period_end`.
6. Fallo de cobro: en **Developer tools → Simulations** (verificar) simula
   `subscription.past_due`, o paga con la tarjeta de rechazo en una renovación. El
   plan se mantiene hasta `current_period_end` y la sección de ajustes avisa.
7. Si el webhook falla, **Notifications → tu destino → Logs** muestra la
   respuesta y permite reenviar el evento (es idempotente).

Si el overlay se cierra pero el plan no cambia: revisa primero los logs de la
terminal (`Paddle webhook failed {eventId, eventType, error}`) y que ngrok siga
apuntando al puerto correcto.

## 6. Tests

```bash
npm test                                   # toda la suite
npx vitest run tests/paddle-signature.test.ts tests/paddle-webhook.test.ts \
  tests/subscription-plans.test.ts tests/paddle.test.ts
```

Cubren: verificación de firma (cuerpo alterado, secreto equivocado, ventana de
tiempo, varios `h1`, encabezados malformados), el webhook (idempotencia, eventos
fuera de orden, `past_due`, cancelación, dueño de la suscripción, price no
configurado, `transaction.completed`) y `resolveUserPlan` / `paddleHasAccess`.

## 7. Checklist para pasar a producción

- [ ] Migración corrida en la base de producción (paso 1).
- [ ] Cuenta **live** de Paddle aprobada y **dominio `sparktodo.com` aprobado**
      (Paddle revisa sitio, precios visibles, términos, privacidad y reembolsos).
- [ ] `[REVISAR]` resueltos en `lib/legal-content.ts` (reembolso, plazo,
      jurisdicción). `npm run check:release` debe dar "ninguno".
- [ ] `/terms`, `/privacy` y `/refund` publicados y enlazados en el footer y en
      `/plans`.
- [ ] La revisión de dominio de Paddle necesita ver los precios **sin iniciar
      sesión**; `/plans` pide login (ver "Pendiente" en el resumen final).
- [ ] Productos y precios **live** creados (USD 6 y USD 20 mensuales), con sus
      `pri_...` nuevos.
- [ ] API key **live** y client-side token **live** (`live_...`).
- [ ] Destino de notificaciones **live** con URL
      `https://sparktodo.com/api/subscriptions/webhook` (sin slash final) y su
      propia secret key.
- [ ] Default payment link live: `https://sparktodo.com/plans`.
- [ ] Variables en Vercel (Production) — tabla abajo.
- [ ] Redeploy (las `NEXT_PUBLIC_*` se inlinean en el build).
- [ ] Compra real de bajo monto con una cuenta propia + reembolso desde Paddle;
      verifica fila en `user_plans`, portal y cancelación.
- [ ] Borrar de Vercel las variables de Lemon Squeezy / Mercado Pago si quedaron.

### Variables de Vercel

| Variable | Tipo | Producción |
|---|---|---|
| `PADDLE_API_KEY` | servidor (secreta) | key live |
| `PADDLE_WEBHOOK_SECRET` | servidor (secreta) | secret del destino live |
| `NEXT_PUBLIC_PADDLE_ENV` | pública | `production` |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | pública | `live_...` |
| `NEXT_PUBLIC_PADDLE_PRICE_PLUS` | pública | `pri_...` live |
| `NEXT_PUBLIC_PADDLE_PRICE_PRO` | pública | `pri_...` live |

`PADDLE_NOTIFICATION_WEBHOOK_SECRET` se acepta como alias de
`PADDLE_WEBHOOK_SECRET`; `PADDLE_PRICE_PLUS|PRO` (sin `NEXT_PUBLIC_`) como respaldo
de los price ids. En Vercel conviene dejar **un solo nombre** de cada una.
