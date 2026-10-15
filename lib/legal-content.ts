import { LEGAL } from "@/lib/legal-config";
import type { LegalContent } from "@/components/legal/legal-document";

const { serviceName: S, operatorName: OP, operatorTaxId: TAX, operatorAddress: ADDR, contactEmail: MAIL } = LEGAL;

export const termsContent: { es: LegalContent; en: LegalContent } = {
  es: {
    title: "Términos y condiciones",
    intro: `Estos términos regulan el uso de ${S} (el "Servicio"), operado por ${OP} (CUIT ${TAX}), con domicilio en ${ADDR} (el "Responsable"). Al crear una cuenta o usar el Servicio aceptas estos términos.`,
    sections: [
      {
        title: "El Servicio",
        body: [
          `${S} es una aplicación para organizar tareas que incluye un asistente de inteligencia artificial llamado Milo. El Servicio se ofrece "tal cual está" y puede cambiar, tener interrupciones o incorporar nuevas funciones.`
        ]
      },
      {
        title: "Cuenta y uso permitido",
        body: [
          "Necesitás una cuenta para usar el Servicio. Eres responsable de la actividad de tu cuenta y de mantener seguro tu acceso. Tienes que ser mayor de 18 años, o contar con autorización de tu representante legal si eres menor.",
          "No puedes usar el Servicio para actividades ilegales, para intentar vulnerar su seguridad, para automatizar el acceso de forma abusiva ni para revenderlo sin autorización."
        ]
      },
      {
        title: "Inteligencia artificial",
        body: [
          "Milo genera respuestas con modelos de lenguaje de terceros. Las respuestas pueden ser incorrectas, incompletas o desactualizadas. No constituyen asesoramiento médico, legal, financiero ni profesional. Verifica la información importante antes de actuar en base a ella.",
          "Los mensajes que le envías a Milo y las tareas relevantes se envían a proveedores de IA para generar la respuesta (ver la Política de privacidad).",
          "El Servicio es una herramienta de organización y productividad. No es un producto sanitario, ni brinda diagnóstico, tratamiento o terapia de ninguna condición, incluido el TDAH. Si necesitas orientación clínica, consulta a un profesional de la salud."
        ]
      },
      {
        title: "Planes, precios y pagos",
        body: [
          `El Servicio ofrece un plan gratuito y planes pagos por suscripción mensual (Plus y Pro). Los precios de referencia son USD ${LEGAL.prices.plus} (Plus) y USD ${LEGAL.prices.pro} (Pro) por mes. Antes de confirmar el pago, Paddle te muestra el importe final en tu moneda local (cuando está disponible) con los impuestos aplicables.`,
          "Los pagos son procesados por Paddle, que actúa como Merchant of Record: es quien te vende la suscripción, cobra, calcula y remite los impuestos aplicables (IVA, sales tax u otros) y emite el recibo, por lo que el Responsable no almacena los datos de tu tarjeta. La compra también se rige por los términos del comprador de Paddle.",
          `El plan Plus puede incluir un período de prueba gratuito de ${LEGAL.trialDays} días, por única vez por persona. Los planes y precios pueden modificarse; los cambios se comunican con anticipación y no afectan el período ya abonado.`,
          "Los límites de uso diario de las funciones de IA dependen del plan y pueden ajustarse."
        ]
      },
      {
        title: "Renovación, cancelación y reembolsos",
        body: [
          "La suscripción se renueva automáticamente cada mes hasta que la canceles. Puedes cancelarla en cualquier momento desde tu cuenta o escribiendo a " + MAIL + "; seguirás con acceso al plan hasta el final del período ya pagado, sin cargos posteriores.",
          "Si contrataste a distancia desde Argentina, tienes derecho a revocar la contratación dentro de los 10 días corridos desde que la contrataste (art. 34 de la Ley 24.240 de Defensa del Consumidor), pidiéndolo a " + MAIL + ". En ese caso se reembolsa el importe pagado.",
          "Fuera de ese plazo, y salvo que la ley disponga otra cosa, los períodos ya iniciados no se reembolsan. La política completa está en /refund."
        ]
      },
      {
        title: "Tu contenido",
        body: [
          "Eres titular del contenido que cargas (tareas, mensajes). Le otorgas al Responsable el permiso limitado necesario para almacenarlo y procesarlo con el único fin de prestarte el Servicio. Puedes eliminar tus tareas cuando quieras y pedir la eliminación de tu cuenta escribiendo a " + MAIL + "."
        ]
      },
      {
        title: "Propiedad intelectual",
        body: [
          `El software, la marca ${S}, el diseño y la mascota Milo pertenecen al Responsable. Estos términos no te transfieren ningún derecho sobre ellos, más allá del uso personal del Servicio.`
        ]
      },
      {
        title: "Limitación de responsabilidad",
        body: [
          "En la máxima medida permitida por la ley, el Responsable no responde por daños indirectos, pérdida de datos, de ganancias u oportunidades derivados del uso o la imposibilidad de usar el Servicio, ni por decisiones tomadas en base a respuestas de la IA. Nada de lo aquí dispuesto limita los derechos que la ley te reconoce como consumidor."
        ]
      },
      {
        title: "Suspensión y baja",
        body: [
          "Podemos suspender o cerrar cuentas que incumplan estos términos o hagan un uso abusivo del Servicio. Vos puedes dejar de usarlo y eliminar tu cuenta en cualquier momento."
        ]
      },
      {
        title: "Ley aplicable y contacto",
        body: [
          `Estos términos se rigen por las leyes de la República Argentina. Para reclamos de consumo puedes acudir a la autoridad de Defensa del Consumidor de tu jurisdicción (argentina.gob.ar/produccion/defensadelconsumidor). Consultas: ${MAIL}.`
        ]
      }
    ]
  },
  en: {
    title: "Terms of Service",
    intro: `These terms govern your use of ${S} (the "Service"), operated by ${OP} (Tax ID ${TAX}), located at ${ADDR} (the "Operator"). By creating an account or using the Service you agree to these terms.`,
    sections: [
      {
        title: "The Service",
        body: [
          `${S} is a task-organizing app that includes an AI assistant called Milo. The Service is provided "as is" and may change, experience interruptions or add new features.`
        ]
      },
      {
        title: "Account and acceptable use",
        body: [
          "You need an account to use the Service. You are responsible for activity on your account and for keeping your access secure. You must be at least 18, or have your legal guardian's permission.",
          "You may not use the Service for illegal activity, to attempt to breach its security, to abusively automate access, or to resell it without permission."
        ]
      },
      {
        title: "Artificial intelligence",
        body: [
          "Milo generates answers using third-party language models. Answers may be incorrect, incomplete or outdated, and are not medical, legal, financial or professional advice. Verify important information before acting on it.",
          "The messages you send to Milo and relevant tasks are sent to AI providers to generate a response (see the Privacy Policy).",
          "The Service is an organization and productivity tool. It is not a medical device and does not provide diagnosis, treatment or therapy for any condition, including ADHD. If you need clinical guidance, consult a health professional."
        ]
      },
      {
        title: "Plans, prices and payments",
        body: [
          `The Service offers a free plan and paid monthly subscriptions (Plus and Pro). Reference prices are USD ${LEGAL.prices.plus} (Plus) and USD ${LEGAL.prices.pro} (Pro) per month. Before you confirm the payment, Paddle shows you the final amount in your local currency (where available) including any applicable taxes.`,
          "Payments are processed by Paddle, which acts as Merchant of Record: it sells you the subscription, collects the payment, calculates and remits the applicable taxes (VAT, sales tax or others) and issues the receipt, so the Operator does not store your card details. Your purchase is also governed by Paddle's buyer terms.",
          `The Plus plan may include a free ${LEGAL.trialDays}-day trial, once per person. Plans and prices may change; changes are announced in advance and do not affect an already-paid period.`,
          "Daily usage limits for AI features depend on your plan and may be adjusted."
        ]
      },
      {
        title: "Renewal, cancellation and refunds",
        body: [
          "Subscriptions renew automatically every month until you cancel. You can cancel at any time from your account or by writing to " + MAIL + "; you keep access until the end of the period you already paid for, with no further charges.",
          "If you purchased remotely from Argentina, you may withdraw within 10 calendar days of purchase (Argentine Consumer Protection Law 24.240, art. 34) by writing to " + MAIL + ", and the amount paid will be refunded.",
          "Outside that window, and unless the law provides otherwise, periods already started are not refunded. The full policy is at /refund."
        ]
      },
      {
        title: "Your content",
        body: [
          "You own the content you upload (tasks, messages). You grant the Operator the limited permission needed to store and process it solely to provide the Service. You can delete your tasks at any time and request account deletion by writing to " + MAIL + "."
        ]
      },
      {
        title: "Intellectual property",
        body: [
          `The software, the ${S} brand, the design and the Milo mascot belong to the Operator. These terms grant you no rights over them beyond personal use of the Service.`
        ]
      },
      {
        title: "Limitation of liability",
        body: [
          "To the maximum extent permitted by law, the Operator is not liable for indirect damages, loss of data, profits or opportunities arising from use of, or inability to use, the Service, or for decisions made based on AI answers. Nothing here limits the rights you have as a consumer under applicable law."
        ]
      },
      {
        title: "Suspension and termination",
        body: [
          "We may suspend or close accounts that breach these terms or abuse the Service. You may stop using it and delete your account at any time."
        ]
      },
      {
        title: "Governing law and contact",
        body: [
          `These terms are governed by the laws of the Argentine Republic. Questions: ${MAIL}.`
        ]
      }
    ]
  }
};

export const privacyContent: { es: LegalContent; en: LegalContent } = {
  es: {
    title: "Política de privacidad",
    intro: `${OP} (CUIT ${TAX}), con domicilio en ${ADDR}, es el responsable del tratamiento de tus datos personales en ${S}. Esta política explica qué datos tratamos, para qué y qué derechos tienes. Contacto: ${MAIL}.`,
    sections: [
      {
        title: "Qué datos recolectamos",
        body: [
          "Cuenta: email, nombre y datos de acceso, gestionados por nuestro proveedor de autenticación (Clerk).",
          "Contenido: tus tareas (título, categoría, descripción, prioridad, duración, fecha), los pasos que la IA genera para dividirlas, tus mensajes a Milo y un resumen breve generado por IA sobre tus hábitos y preferencias (la \"memoria\" de Milo).",
          "Suscripción: plan contratado, estado y email de pago. Los datos de tarjeta los procesa el procesador de pagos y no llegan a nosotros.",
          "Uso: contadores de uso diario de las funciones de IA y registros técnicos de errores."
        ]
      },
      {
        title: "Para qué los usamos",
        body: [
          "Para prestarte el Servicio (guardar tus tareas, responder con Milo, recomendarte prioridades), gestionar tu suscripción, aplicar límites de uso, prevenir abueres y mejorar la estabilidad del Servicio. No vendemos tus datos ni los usamos para publicidad."
        ]
      },
      {
        title: "Con quién los compartimos",
        body: [
          "Usamos proveedores que tratan datos por nuestra cuenta: Clerk (autenticación), Neon (base de datos), Vercel (alojamiento), Groq (modelos de IA que procesan tus mensajes y tareas), Tavily (búsqueda web cuando Milo la usa; se envían los términos de la consulta), Paddle (procesamiento de pagos y facturación, como Merchant of Record).",
          "Estos proveedores pueden estar ubicados fuera de Argentina, incluidos Estados Unidos, por lo que tus datos pueden transferirse internacionalmente. Solo los compartimos en la medida necesaria para prestar el Servicio."
        ]
      },
      {
        title: "Inteligencia artificial",
        body: [
          "Lo que escribes en el chat de Milo, las tareas relevantes y el título de la tarea que pides dividir en pasos se envían al proveedor de IA para generar respuestas. No introduzcas información sensible (contraseñas, datos bancarios, datos de salud) en el chat ni en los títulos de tus tareas.",
          "Dictado por voz: si usas el micrófono, el reconocimiento de voz lo realiza tu propio navegador. Según el navegador que uses (por ejemplo, Chrome), el audio puede enviarse a los servidores de ese navegador para convertirlo en texto. Ese tratamiento se rige por la política de privacidad de tu navegador, no por la nuestra. Nosotros solo recibimos el texto resultante y no guardamos audio."
        ]
      },
      {
        title: "Cookies y almacenamiento local",
        body: [
          "Usamos cookies esenciales para mantener tu sesión iniciada (Clerk) y almacenamiento local del navegador para recordar tu idioma y tus preferencias de recordatorios. No usamos cookies publicitarias ni de seguimiento de terceros. Si activas los recordatorios, tu navegador nos concede permiso para mostrarte notificaciones; puedes revocarlo cuando quieras desde la configuración del navegador."
        ]
      },
      {
        title: "Conservación",
        body: [
          "Conservamos tus datos mientras tu cuenta esté activa. Si pides la eliminación de tu cuenta, borramos tus tareas, tu memoria de Milo y tus datos asociados, salvo lo que debamos conservar por obligaciones legales o contables (por ejemplo, registros de facturación)."
        ]
      },
      {
        title: "Tus derechos",
        body: [
          `Puedes acceder, rectificar y suprimir tus datos y oponerte a su tratamiento escribiendo a ${MAIL}. Respondemos dentro de los plazos legales.`,
          "En Argentina, la Agencia de Acceso a la Información Pública (AAIP), órgano de control de la Ley 25.326 de Protección de Datos Personales, tiene la atribución de atender denuncias y reclamos relacionados con el incumplimiento de las normas de protección de datos personales.",
          "Si estás en el Espacio Económico Europeo o el Reino Unido, también tienes los derechos que reconoce el GDPR, incluido el de reclamar ante tu autoridad de control."
        ]
      },
      {
        title: "Seguridad",
        body: [
          "Aplicamos medidas técnicas razonables (conexiones cifradas, control de acceso por usuario), pero ningún sistema es 100% seguro."
        ]
      },
      {
        title: "Menores y cambios",
        body: [
          "El Servicio no está dirigido a menores de 18 años. Podemos actualizar esta política; publicaremos la nueva versión con su fecha y, si el cambio es importante, te avisaremos."
        ]
      }
    ]
  },
  en: {
    title: "Privacy Policy",
    intro: `${OP} (Tax ID ${TAX}), located at ${ADDR}, is the controller of your personal data in ${S}. This policy explains what data we process, why, and your rights. Contact: ${MAIL}.`,
    sections: [
      {
        title: "Data we collect",
        body: [
          "Account: email, name and sign-in data, managed by our authentication provider (Clerk).",
          "Content: your tasks (title, category, description, priority, duration, date), the steps the AI generates to break them down, your messages to Milo, and a short AI-generated summary of your habits and preferences (Milo's \"memory\").",
          "Subscription: plan, status and billing email. Card details are handled by the payment processor and never reach us.",
          "Usage: daily usage counters for AI features and technical error logs."
        ]
      },
      {
        title: "How we use it",
        body: [
          "To provide the Service (store your tasks, answer with Milo, recommend priorities), manage your subscription, enforce usage limits, prevent abuse and keep the Service stable. We do not sell your data or use it for advertising."
        ]
      },
      {
        title: "Who we share it with",
        body: [
          "We use providers that process data on our behalf: Clerk (authentication), Neon (database), Vercel (hosting), Groq (AI models that process your messages and tasks), Tavily (web search when Milo uses it; the query terms are sent), Paddle (payment processing and invoicing, as Merchant of Record).",
          "These providers may be located outside Argentina, including the United States, so your data may be transferred internationally. We share it only as needed to provide the Service."
        ]
      },
      {
        title: "Artificial intelligence",
        body: [
          "What you type in Milo's chat, relevant tasks and the title of any task you ask to break down are sent to the AI provider to generate answers. Do not enter sensitive information (passwords, banking or health data) in the chat or in your task titles.",
          "Voice dictation: when you use the microphone, speech recognition is performed by your own browser. Depending on the browser (Chrome, for example), the audio may be sent to that browser vendor's servers to be turned into text. That processing is governed by your browser's privacy policy, not ours. We only receive the resulting text and never store audio."
        ]
      },
      {
        title: "Cookies and local storage",
        body: [
          "We use essential cookies to keep you signed in (Clerk) and browser local storage to remember your language and your reminder preferences. We do not use advertising or third-party tracking cookies. If you turn on reminders, your browser grants us permission to show you notifications; you can revoke it at any time in your browser settings."
        ]
      },
      {
        title: "Retention",
        body: [
          "We keep your data while your account is active. If you request account deletion, we delete your tasks, Milo's memory and associated data, except what we must keep for legal or accounting obligations (e.g. billing records)."
        ]
      },
      {
        title: "Your rights",
        body: [
          `You may access, correct and delete your data and object to its processing by writing to ${MAIL}. We respond within the legal deadlines.`,
          "In Argentina, the Access to Public Information Agency (AAIP), the supervisory authority under Law 25.326 on Personal Data Protection, handles complaints about breaches of data protection rules.",
          "If you are in the European Economic Area or the UK, you also have the rights granted by the GDPR, including the right to lodge a complaint with your supervisory authority."
        ]
      },
      {
        title: "Security",
        body: [
          "We apply reasonable technical measures (encrypted connections, per-user access control), but no system is 100% secure."
        ]
      },
      {
        title: "Minors and changes",
        body: [
          "The Service is not directed at people under 18. We may update this policy; we will publish the new version with its date and notify you of important changes."
        ]
      }
    ]
  }
};

/**
 * Borrador de la política de reembolsos. Todo lo marcado [REVISAR] es una decisión del Responsable:
 * `npm run check:release` falla mientras quede alguno, para que no se publique sin resolverlo.
 */
export const refundContent: { es: LegalContent; en: LegalContent } = {
  es: {
    title: "Política de reembolsos",
    intro: `Esta política complementa los Términos y condiciones de ${S}. Los pagos los procesa Paddle, que actúa como Merchant of Record; los reembolsos se emiten a través de Paddle al mismo medio de pago con el que pagaste.`,
    sections: [
      {
        title: "Prueba gratuita",
        body: [
          `El plan Plus incluye una prueba gratuita de ${LEGAL.trialDays} días, por única vez por persona y sin cargar tarjeta. Durante la prueba no se cobra nada, así que no hay nada que reembolsar.`
        ]
      },
      {
        title: "Reembolso de tu primer pago",
        body: [
          `Si no estás conforme, puedes pedir el reembolso total de tu primer pago dentro de los [REVISAR: 14] días corridos desde la compra, escribiendo a ${MAIL}. [REVISAR: el plazo no puede ser menor a 10 días corridos, que es el derecho de revocación del art. 34 de la Ley 24.240 que ya figura en los Términos; unificar ambos números].`,
          "Aplica a la primera suscripción de cada persona a cada plan."
        ]
      },
      {
        title: "Renovaciones y cancelación",
        body: [
          "La suscripción se renueva cada mes hasta que la canceles. Cancelar evita los cobros siguientes y conservas el acceso hasta el final del período ya pagado.",
          "[REVISAR: elegir una de estas dos] (a) Las renovaciones ya cobradas no se reembolsan, salvo cobro erróneo o duplicado. (b) Puedes pedir el reembolso de una renovación dentro de los [N] días de cobrada."
        ]
      },
      {
        title: "Cobros duplicados o erróneos",
        body: [
          `Si te cobraron dos veces o un importe incorrecto, escríbenos a ${MAIL} y lo reembolsamos completo, sin importar el plazo.`
        ]
      },
      {
        title: "Cómo pedirlo",
        body: [
          `Escribe a ${MAIL} desde el email de tu cuenta, con la fecha aproximada de la compra. Respondemos en [REVISAR: 5] días hábiles. Una vez aprobado, Paddle emite el reembolso y la acreditación puede demorar varios días hábiles según tu banco o tarjeta.`
        ]
      },
      {
        title: "Importe, impuestos y moneda",
        body: [
          "Se reembolsa el importe que pagaste, impuestos incluidos, en la moneda en que pagaste. [REVISAR: confirmar si se compensan diferencias de tipo de cambio; lo habitual es que no]."
        ]
      },
      {
        title: "Jurisdicción y derechos del consumidor",
        body: [
          "Esta política se rige por las leyes de la República Argentina. [REVISAR: confirmar jurisdicción y, si corresponde, tribunales competentes]. No afecta los derechos que la ley te reconoce como consumidor y que no pueden renunciarse."
        ]
      }
    ]
  },
  en: {
    title: "Refund Policy",
    intro: `This policy supplements the ${S} Terms of Service. Payments are processed by Paddle, which acts as Merchant of Record; refunds are issued through Paddle to the payment method you used.`,
    sections: [
      {
        title: "Free trial",
        body: [
          `The Plus plan includes a free ${LEGAL.trialDays}-day trial, once per person and without entering a card. Nothing is charged during the trial, so there is nothing to refund.`
        ]
      },
      {
        title: "Refund of your first payment",
        body: [
          `If you are not satisfied, you can request a full refund of your first payment within [REVISAR: 14] calendar days of purchase by writing to ${MAIL}. [REVISAR: the window cannot be shorter than 10 calendar days, the withdrawal right (Law 24.240, art. 34) already stated in the Terms; align both numbers].`,
          "This applies to each person's first subscription to each plan."
        ]
      },
      {
        title: "Renewals and cancellation",
        body: [
          "Subscriptions renew every month until you cancel. Cancelling stops future charges and you keep access until the end of the period you already paid for.",
          "[REVISAR: pick one] (a) Renewals already charged are not refunded, except for erroneous or duplicate charges. (b) You may request a refund of a renewal within [N] days of the charge."
        ]
      },
      {
        title: "Duplicate or erroneous charges",
        body: [
          `If you were charged twice or an incorrect amount, write to ${MAIL} and we will refund it in full, regardless of the time elapsed.`
        ]
      },
      {
        title: "How to request one",
        body: [
          `Write to ${MAIL} from your account email, with the approximate date of purchase. We reply within [REVISAR: 5] business days. Once approved, Paddle issues the refund and it may take several business days to reach your bank or card.`
        ]
      },
      {
        title: "Amount, taxes and currency",
        body: [
          "You are refunded the amount you paid, taxes included, in the currency you paid in. [REVISAR: confirm whether exchange-rate differences are compensated; usually they are not]."
        ]
      },
      {
        title: "Jurisdiction and consumer rights",
        body: [
          "This policy is governed by the laws of the Argentine Republic. [REVISAR: confirm jurisdiction and, if applicable, competent courts]. It does not affect the rights the law gives you as a consumer that cannot be waived."
        ]
      }
    ]
  }
};
