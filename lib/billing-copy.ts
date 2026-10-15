import type { AppLanguage } from "@/lib/i18n";

/**
 * Textos de cobro (checkout, administrar suscripción, estado). Español e inglés escritos a mano;
 * el resto de los idiomas muestra inglés (`billingCopy`), igual que `replanCopy`.
 */
export type BillingCopy = {
  checkoutSuccessTitle: string;
  checkoutSuccessBody: string;
  checkoutNotReady: string;
  taxNote: string;
  pricingBack: string;
  settings: {
    title: string;
    plan: string;
    status: string;
    renews: string;
    endsOn: string;
    manage: string;
    opening: string;
    portalError: string;
    viewPlans: string;
    freeNote: string;
    cancelsNote: (date: string) => string;
    pastDueNote: string;
    statuses: Record<"active" | "trialing" | "past_due" | "paused" | "canceled", string>;
  };
};

const en: BillingCopy = {
  checkoutSuccessTitle: "Payment received. Thank you!",
  checkoutSuccessBody:
    "Your plan switches on in a few seconds, as soon as Paddle confirms the payment. If it still shows Free in a minute, reload the page.",
  checkoutNotReady: "The checkout is not ready yet. Reload the page and try again.",
  pricingBack: "← Back to Spark",
  taxNote:
    "Prices are per month and billed in US dollars, or in your local currency where available. Paddle is our Merchant of Record: it processes the payment and calculates, collects and remits the applicable taxes, which you see before you pay. Cancel any time; you keep access until the end of the period you paid for.",
  settings: {
    title: "Subscription",
    plan: "Current plan",
    status: "Status",
    renews: "Next renewal",
    endsOn: "Access until",
    manage: "Manage subscription",
    opening: "Opening…",
    portalError: "Could not open the billing portal. Try again in a moment.",
    viewPlans: "See plans",
    freeNote: "You are on the Free plan.",
    cancelsNote: (date) => `Your subscription is cancelled and stays active until ${date}.`,
    pastDueNote: "We could not charge your card. Update your payment method to keep your plan.",
    statuses: { active: "Active", trialing: "Trial", past_due: "Payment failed", paused: "Paused", canceled: "Cancelled" }
  }
};

const es: BillingCopy = {
  checkoutSuccessTitle: "¡Pago recibido, gracias!",
  checkoutSuccessBody:
    "Tu plan se activa en unos segundos, apenas Paddle confirma el pago. Si en un minuto sigue figurando Free, recargá la página.",
  checkoutNotReady: "El checkout todavía no está listo. Recargá la página y probá de nuevo.",
  pricingBack: "← Volver a Spark",
  taxNote:
    "Los precios son por mes y se cobran en dólares estadounidenses, o en tu moneda local cuando está disponible. Paddle es nuestro Merchant of Record: procesa el pago y calcula, cobra y remite los impuestos aplicables, que ves antes de pagar. Cancelás cuando quieras y conservás el acceso hasta el final del período pagado.",
  settings: {
    title: "Suscripción",
    plan: "Plan actual",
    status: "Estado",
    renews: "Próxima renovación",
    endsOn: "Acceso hasta",
    manage: "Administrar suscripción",
    opening: "Abriendo…",
    portalError: "No pudimos abrir el portal de facturación. Probá de nuevo en un momento.",
    viewPlans: "Ver planes",
    freeNote: "Estás en el plan Free.",
    cancelsNote: (date) => `Cancelaste la suscripción; sigue activa hasta el ${date}.`,
    pastDueNote: "No pudimos cobrar tu tarjeta. Actualizá el medio de pago para conservar tu plan.",
    statuses: { active: "Activa", trialing: "En prueba", past_due: "Pago fallido", paused: "Pausada", canceled: "Cancelada" }
  }
};

export function billingCopy(language: AppLanguage): BillingCopy {
  return language === "es" ? es : en;
}
