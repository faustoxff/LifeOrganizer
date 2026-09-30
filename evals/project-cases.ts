import type { IntakeAnswer } from "@/types/project";

/**
 * Casos de proyectos reales para juzgar la calidad de las preguntas y de las
 * subtareas que arma la IA. Como con los de Milo, los chequeos son de forma y de
 * sentido común (qué no puede faltar, qué no puede aparecer), no de un texto exacto:
 * dos buenos planes nunca se parecen.
 */

/** Un lunes. */
export const TODAY = "2026-09-28";

export type ProjectCase = {
  name: string;
  project: { title: string; description: string; deadline: string; contextSummary?: string };
  /** Cómo contestaría una persona real las preguntas que haga la IA (para armar el plan). */
  answers?: IntakeAnswer[];
  expect: {
    /** Cuántas preguntas es razonable que haga. */
    questions: { min: number; max: number };
    /** Al menos una pregunta tiene que tocar alguno de estos temas (el que cambia el plan). */
    questionTopics?: RegExp[];
    /** Cada elemento: alguna subtarea tiene que mencionarlo (cubre el proyecto entero). */
    coverage: RegExp[];
    /** Rango razonable de subtareas para este proyecto. */
    subtasks: { min: number; max: number };
    /** Con la disponibilidad por defecto, el plan del scheduler tiene que entrar. */
    feasible: boolean;
  };
  note?: string;
};

export const CASES: ProjectCase[] = [
  {
    name: "TP universitario con consigna",
    project: {
      title: "TP final de Análisis Matemático",
      description: "Tengo que entregar el trabajo práctico final de la materia. Es individual.",
      deadline: "2026-10-16",
      contextSummary:
        "## consigna.pdf\nTP final de Análisis Matemático II. Resolver 6 ejercicios de integrales dobles y series (guía adjunta). " +
        "Entregar un informe en PDF de hasta 8 páginas con el desarrollo de cada ejercicio y una conclusión de una página. " +
        "Se puede usar software para verificar resultados pero hay que mostrar el desarrollo a mano. " +
        "Entrega por el campus virtual antes de las 23:59 del 16/10. Presentación oral opcional de 10 minutos."
    },
    answers: [
      { id: "q1", question: "¿Ya resolviste algún ejercicio?", answer: "Solo el 1, el resto no lo empecé." },
      { id: "q2", question: "¿Vas a hacer la presentación oral opcional?", answer: "No." }
    ],
    expect: {
      // La consigna ya dice casi todo: preguntar mucho sería molestar.
      questions: { min: 0, max: 3 },
      questionTopics: [/empez|avanz|hech|resuelt|ya /i, /grupal|individual|equipo/i, /oral|presentaci/i],
      coverage: [/ejercicio/i, /informe/i, /conclusi/i],
      subtasks: { min: 6, max: 18 },
      feasible: true
    }
  },
  {
    name: "Mudanza",
    project: {
      title: "Mudanza al departamento nuevo",
      description:
        "Me mudo el 25 de octubre a un departamento de 2 ambientes en otra ciudad. Vivo en un 3 ambientes con muchas cosas. " +
        "Tengo que dar de baja servicios, embalar, contratar flete y dejar el departamento actual en condiciones.",
      deadline: "2026-10-24"
    },
    expect: {
      // Falta info clave: cuánto hay hecho, si contrata flete, cuándo entrega las llaves.
      questions: { min: 1, max: 5 },
      questionTopics: [/flete|mudanza|contrat|camión/i, /llaves|entreg|contrato|alquiler/i, /hech|avanz|empez|ya /i],
      coverage: [/embal|caja/i, /flete|transporte|mudanza/i, /servicio|luz|gas|internet|baja/i, /limpi|entreg|llaves/i],
      subtasks: { min: 8, max: 22 },
      feasible: true
    }
  },
  {
    name: "Preparar un parcial",
    project: {
      title: "Parcial de Física II",
      description:
        "Rindo el parcial de Física II el 9 de octubre. Entra electrostática, campo eléctrico, potencial, capacitores y circuitos de corriente continua. " +
        "Tengo los apuntes y la guía de problemas completa, pero casi no estudié.",
      deadline: "2026-10-09"
    },
    answers: [
      { id: "q1", question: "¿Cuánto tiempo por día podés estudiar?", answer: "Unas 2 horas por día." },
      { id: "q2", question: "¿Qué tema te cuesta más?", answer: "Circuitos y capacitores." }
    ],
    expect: {
      questions: { min: 0, max: 4 },
      questionTopics: [/cuesta|dificil|difícil|flojo|débil|tema/i, /tiempo|horas|por día|por dia/i, /guía|problemas|práctic|hech/i],
      coverage: [/electrost|campo|potencial/i, /capacitor|circuito|corriente/i, /problema|ejercicio|guía/i, /repaso|simulacro|resumen|revis/i],
      subtasks: { min: 6, max: 20 },
      feasible: true
    }
  },
  {
    name: "Organizar un evento",
    project: {
      title: "Cumpleaños sorpresa de mi mamá",
      description:
        "Quiero organizarle una fiesta sorpresa a mi mamá por sus 60 años el sábado 24 de octubre. Serían unas 30 personas. " +
        "Pensaba hacerlo en casa de mi tía. Tengo un presupuesto de unos 300 mil pesos.",
      deadline: "2026-10-24"
    },
    expect: {
      questions: { min: 1, max: 5 },
      questionTopics: [/invitad|gente|lista|personas/i, /comida|catering|torta|menú|menu/i, /sorpresa|avis|tía|tia|lugar|casa/i, /hermano|ayuda|colabor|solo|sola/i],
      coverage: [/invit|lista/i, /comida|torta|catering|menú|menu/i, /decorac|ambient|lugar|casa/i, /sorpresa|coordin|distra/i],
      subtasks: { min: 7, max: 22 },
      feasible: true
    }
  },
  {
    name: "Proyecto vago (hay que preguntar)",
    project: {
      title: "Armar mi portfolio",
      description: "Quiero tener un portfolio online para conseguir trabajo como diseñador.",
      deadline: "2026-11-13"
    },
    expect: {
      // Casi nada está dicho: acá preguntar es lo correcto.
      questions: { min: 2, max: 5 },
      questionTopics: [/proyectos|trabajos|casos|material|tenés|tienes/i, /plataforma|sitio|web|herramienta|dominio/i, /objetivo|público|publico|empresa|cliente/i],
      coverage: [/proyecto|caso|trabajo/i, /diseñ|estructura|layout|wireframe/i, /publica|lanz|subir|dominio|online/i, /revis|feedback|prueba/i],
      subtasks: { min: 6, max: 22 },
      feasible: true
    },
    note: "Es el caso que castiga a una IA que arma un plan genérico sin preguntar."
  }
];
