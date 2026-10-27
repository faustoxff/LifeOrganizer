// Datos del responsable del servicio. Se renderizan en /terms, /privacy y /refunds:
// un placeholder acá es un bloqueo para publicar, y `npm run check:release`
// falla si queda alguno.
export const LEGAL = {
  serviceName: "Spark",
  // Debe coincidir con el nombre que figura en la inscripción del CUIT.
  operatorName: "Fausto Zaccanti",
  // CUIT/CUIL del responsable (obligatorio para facturar en Argentina).
  operatorTaxId: "20-46690907-7",
  operatorAddress: "San Lorenzo 2523, B7600 Mar del Plata, Buenos Aires, Argentina",
  contactEmail: "faustozaccanti@gmail.com",
  lastUpdated: "2026-10-27",
  // Precios en USD: Paddle cobra en dólares estadounidenses.
  prices: { plus: 6, pro: 20 },
  trialDays: 14
} as const;
