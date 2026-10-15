import type { AppLanguage } from "@/lib/i18n";

/**
 * Textos de cobro (checkout, administrar suscripción, estado). Español e inglés escritos a mano;
 * el resto de los idiomas muestra inglés (`billingCopy`), igual que `replanCopy`.
 */
export type BillingCopy = {
  checkoutSuccessTitle: string;
  checkoutSuccessBody: string;
  checkoutNotReady: string;
};

const en: BillingCopy = {
  checkoutSuccessTitle: "Payment received. Thank you!",
  checkoutSuccessBody:
    "Your plan switches on in a few seconds, as soon as Paddle confirms the payment. If it still shows Free in a minute, reload the page.",
  checkoutNotReady: "The checkout is not ready yet. Reload the page and try again."
};

const es: BillingCopy = {
  checkoutSuccessTitle: "¡Pago recibido, gracias!",
  checkoutSuccessBody:
    "Tu plan se activa en unos segundos, apenas Paddle confirma el pago. Si en un minuto sigue figurando Free, recargá la página.",
  checkoutNotReady: "El checkout todavía no está listo. Recargá la página y probá de nuevo."
};

export function billingCopy(language: AppLanguage): BillingCopy {
  return language === "es" ? es : en;
}
