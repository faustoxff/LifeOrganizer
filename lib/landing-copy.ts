import type { AppLanguage } from "@/lib/i18n";

export type LandingCopy = {
  metaTitle: string;
  metaDescription: string;
  login: string;
  badge: string;
  heroTitle: string;
  heroText: string;
  seePlans: string;
  noCard: string;
  featuresTitle: string;
  features: { title: string; text: string }[];
  howTitle: string;
  steps: { title: string; text: string }[];
  priceNote: string;
  faqTitle: string;
  faqs: { q: string; a: string }[];
  finalTitle: string;
  finalCta: string;
  appDescription: string;
};

// Plan names, feature lists, "/month", trial badge and plan CTAs are reused from lib/i18n (copy.plans).
export const landingCopy: Record<AppLanguage, LandingCopy> = {
  en: {
    metaTitle: "Spark — AI task organizer",
    metaDescription: "Spark is your AI task organizer. Milo helps you prioritize, schedule and decide what to do today. Start free.",
    login: "Log in",
    badge: "AI task organizer",
    heroTitle: "For when you know what to do but can't start.",
    heroText: "Spark picks one task, splits it into two-minute steps and starts a timer. Built for brains that stall at the starting line.",
    seePlans: "See plans",
    noCard: "No card needed. Cancel anytime.",
    featuresTitle: "Everything you need to get organized",
    features: [
      { title: "Tells you what to do first", text: "Combines priority, due date and time available to pick the one task that makes the most sense right now." },
      { title: "Breaks it into tiny steps", text: "Stuck on something big? Milo splits it into concrete actions, starting with one that takes under two minutes." },
      { title: "Focus mode", text: "One task, one step, one timer. Everything else disappears from the screen." },
      { title: "Milo, your assistant", text: "Chat or talk to an AI that knows your list, searches the web and remembers how you work." }
    ],
    howTitle: "How it works",
    steps: [
      { title: "Write down the task", text: "Just the title. Priority and date are optional." },
      { title: "Spark breaks it down", text: "It picks the one that matters now and splits it into steps you can start." },
      { title: "Press start", text: "Focus mode shows one step and a timer. Nothing else." }
    ],
    priceNote: "Reference prices in US dollars.",
    faqTitle: "Frequently asked questions",
    faqs: [
      { q: "Is it made for ADHD?", a: "Spark is built around getting started, which is where many people with ADHD get stuck: one task at a time, tiny steps and a visible timer. It is a productivity tool, not a medical treatment or a diagnosis." },
      { q: "Is it free?", a: "Yes. The Free plan costs nothing and needs no card. If you want more, you can try Plus free for 14 days." },
      { q: "Can I cancel anytime?", a: "Yes. You can cancel from your account whenever you like and keep your plan until the end of the paid period." },
      { q: "How do I pay?", a: "Payments are handled by Paddle, our merchant of record: they take the payment, deal with the sales tax and file it, so you never have to. Card details never touch our servers." },
      { q: "Is the AI always right?", a: "No. Milo is an aid and can be wrong: verify important things before acting on its answers." },
      { q: "What happens to my data?", a: "Your tasks are yours. We don't sell your data or use it for advertising. More details in the Privacy Policy." }
    ],
    finalTitle: "Start today, it's free",
    finalCta: "Create my account",
    appDescription: "Task organizer with an AI assistant."
  },
  es: {
    metaTitle: "Spark — Organizador de tareas con IA",
    metaDescription: "Spark es tu organizador de tareas con IA. Milo te ayuda a priorizar, agendar y decidir qué hacer hoy. Empieza gratis.",
    login: "Iniciar sesión",
    badge: "Organizador de tareas con IA",
    heroTitle: "Para cuando sabes qué hacer pero no puedes empezar.",
    heroText: "Spark elige una sola tarea, la divide en pasos de dos minutos y pone un temporizador. Pensado para cerebros que se traban al arrancar.",
    seePlans: "Ver planes",
    noCard: "Sin tarjeta. Cancela cuando quieras.",
    featuresTitle: "Todo lo que necesitas para organizarte",
    features: [
      { title: "Te dice qué hacer primero", text: "Combina prioridad, vencimiento y tiempo disponible para elegir la única tarea que más conviene ahora." },
      { title: "La divide en pasos diminutos", text: "¿Te trabas con algo grande? Milo lo parte en acciones concretas, empezando por una de menos de dos minutos." },
      { title: "Modo foco", text: "Una tarea, un paso, un temporizador. Todo lo demás desaparece de la pantalla." },
      { title: "Milo, tu asistente", text: "Escribe o habla con una IA que conoce tu lista, busca en la web y recuerda cómo trabajas." }
    ],
    howTitle: "Cómo funciona",
    steps: [
      { title: "Escribe la tarea", text: "Solo el título. La prioridad y la fecha son opcionales." },
      { title: "Spark la desarma", text: "Elige la que importa ahora y la divide en pasos que sí puedes empezar." },
      { title: "Pulsa iniciar", text: "El modo foco deja un paso y un temporizador. Nada más." }
    ],
    priceNote: "Precios de referencia en dólares estadounidenses.",
    faqTitle: "Preguntas frecuentes",
    faqs: [
      { q: "¿Sirve para el TDAH?", a: "Spark está pensado alrededor de empezar, que es donde muchas personas con TDAH se traban: una tarea a la vez, pasos diminutos y un temporizador a la vista. Es una herramienta de productividad, no un tratamiento médico ni un diagnóstico." },
      { q: "¿Es gratis?", a: "Sí. El plan Free no tiene costo ni pide tarjeta. Si quieres más, puedes probar Plus 14 días sin cargo." },
      { q: "¿Puedo cancelar cuando quiera?", a: "Sí. Cancelas desde tu cuenta cuando quieras y conservas el plan hasta el final del período pagado." },
      { q: "¿Cómo se paga?", a: "Los pagos los procesa Paddle, que es el merchant of record: cobra, se ocupa del impuesto y lo presenta, así que vos no tenés nada que hacer. Los datos de tu tarjeta nunca pasan por nuestros servidores." },
      { q: "¿La IA siempre acierta?", a: "No. Milo es una ayuda y puede equivocarse: verifica lo importante antes de actuar según sus respuestas." },
      { q: "¿Qué pasa con mis datos?", a: "Tus tareas son tuyas. No vendemos tus datos ni los usamos para publicidad. Más detalles en la Política de privacidad." }
    ],
    finalTitle: "Empieza hoy, es gratis",
    finalCta: "Crear mi cuenta",
    appDescription: "Organizador de tareas con asistente de IA."
  },
  pt: {
    metaTitle: "Spark — Organizador de tarefas com IA",
    metaDescription: "O Spark é seu organizador de tarefas com IA. O Milo ajuda você a priorizar, agendar e decidir o que fazer hoje. Comece grátis.",
    login: "Entrar",
    badge: "Organizador de tarefas com IA",
    heroTitle: "Para quando você sabe o que fazer mas não consegue começar.",
    heroText: "O Spark escolhe uma tarefa, divide em passos de dois minutos e liga um cronômetro. Feito para cérebros que travam na largada.",
    seePlans: "Ver planos",
    noCard: "Sem cartão. Cancele quando quiser.",
    featuresTitle: "Tudo o que você precisa para se organizar",
    features: [
      { title: "Diz o que fazer primeiro", text: "Combina prioridade, prazo e tempo disponível para escolher a única tarefa que mais vale a pena agora." },
      { title: "Divide em passos mínimos", text: "Travou em algo grande? O Milo divide em ações concretas, começando por uma de menos de dois minutos." },
      { title: "Modo foco", text: "Uma tarefa, um passo, um cronômetro. Todo o resto some da tela." },
      { title: "Milo, seu assistente", text: "Escreva ou fale com uma IA que conhece sua lista, pesquisa na web e lembra como você trabalha." }
    ],
    howTitle: "Como funciona",
    steps: [
      { title: "Escreva a tarefa", text: "Só o título. Prioridade e data são opcionais." },
      { title: "O Spark desmonta", text: "Escolhe a que importa agora e divide em passos que dá para começar." },
      { title: "Aperte iniciar", text: "O modo foco mostra um passo e um cronômetro. Mais nada." }
    ],
    priceNote: "Preços de referência em dólares americanos.",
    faqTitle: "Perguntas frequentes",
    faqs: [
      { q: "Serve para TDAH?", a: "O Spark foi pensado em torno de começar, que é onde muita gente com TDAH trava: uma tarefa por vez, passos mínimos e um cronômetro à vista. É uma ferramenta de produtividade, não um tratamento médico nem um diagnóstico." },
      { q: "É grátis?", a: "Sim. O plano Free não tem custo e não pede cartão. Se quiser mais, você pode testar o Plus por 14 dias sem custo." },
      { q: "Posso cancelar quando quiser?", a: "Sim. Você cancela pela sua conta quando quiser e mantém o plano até o fim do período pago." },
      { q: "Como pago?", a: "Os pagamentos são processados pelo Paddle, nosso merchant of record: ele recebe o pagamento, cuida do imposto sobre vendas e o declara, então você não precisa se preocupar. Os dados do seu cartão nunca passam pelos nossos servidores." },
      { q: "A IA sempre acerta?", a: "Não. O Milo é um apoio e pode errar: confira o que for importante antes de agir com base nas respostas." },
      { q: "O que acontece com meus dados?", a: "Suas tarefas são suas. Não vendemos seus dados nem os usamos para publicidade. Mais detalhes na Política de Privacidade." }
    ],
    finalTitle: "Comece hoje, é grátis",
    finalCta: "Criar minha conta",
    appDescription: "Organizador de tarefas com assistente de IA."
  },
  fr: {
    metaTitle: "Spark — Organisateur de tâches avec IA",
    metaDescription: "Spark est votre organisateur de tâches avec IA. Milo vous aide à prioriser, planifier et décider quoi faire aujourd'hui. Commencez gratuitement.",
    login: "Se connecter",
    badge: "Organisateur de tâches avec IA",
    heroTitle: "Pour quand vous savez quoi faire mais n'arrivez pas à commencer.",
    heroText: "Spark choisit une seule tâche, la découpe en étapes de deux minutes et lance un minuteur. Conçu pour les cerveaux qui calent au démarrage.",
    seePlans: "Voir les plans",
    noCard: "Sans carte. Annulez à tout moment.",
    featuresTitle: "Tout ce qu'il faut pour vous organiser",
    features: [
      { title: "Vous dit quoi faire en premier", text: "Croise priorité, échéance et temps disponible pour choisir la seule tâche qui compte maintenant." },
      { title: "La découpe en toutes petites étapes", text: "Bloqué sur quelque chose de gros ? Milo le découpe en actions concrètes, à partir d'une de moins de deux minutes." },
      { title: "Mode focus", text: "Une tâche, une étape, un minuteur. Tout le reste disparaît de l'écran." },
      { title: "Milo, votre assistant", text: "Écrivez ou parlez à une IA qui connaît votre liste, cherche sur le web et retient votre façon de travailler." }
    ],
    howTitle: "Comment ça marche",
    steps: [
      { title: "Notez la tâche", text: "Juste le titre. La priorité et la date sont facultatives." },
      { title: "Spark la démonte", text: "Il choisit celle qui compte maintenant et la découpe en étapes réellement faisables." },
      { title: "Appuyez sur démarrer", text: "Le mode focus affiche une étape et un minuteur. Rien d'autre." }
    ],
    priceNote: "Prix de référence en dollars américains.",
    faqTitle: "Questions fréquentes",
    faqs: [
      { q: "Est-ce fait pour le TDAH ?", a: "Spark est conçu autour du démarrage, là où beaucoup de personnes avec un TDAH bloquent : une tâche à la fois, de toutes petites étapes et un minuteur visible. C'est un outil de productivité, pas un traitement médical ni un diagnostic." },
      { q: "Est-ce gratuit ?", a: "Oui. Le plan Free est gratuit et ne demande pas de carte. Si vous en voulez plus, vous pouvez essayer Plus gratuitement pendant 14 jours." },
      { q: "Puis-je annuler à tout moment ?", a: "Oui. Vous annulez depuis votre compte quand vous voulez et gardez votre plan jusqu'à la fin de la période payée." },
      { q: "Comment payer ?", a: "Les paiements sont traités par Paddle, notre merchant of record : il encaisse le paiement, gère la taxe de vente et la déclare, vous n'avez donc rien à faire. Les données de votre carte ne passent jamais par nos serveurs." },
      { q: "L'IA a-t-elle toujours raison ?", a: "Non. Milo est une aide et peut se tromper : vérifiez les informations importantes avant d'agir selon ses réponses." },
      { q: "Que deviennent mes données ?", a: "Vos tâches vous appartiennent. Nous ne vendons pas vos données et ne les utilisons pas pour la publicité. Plus de détails dans la Politique de confidentialité." }
    ],
    finalTitle: "Commencez aujourd'hui, c'est gratuit",
    finalCta: "Créer mon compte",
    appDescription: "Organisateur de tâches avec assistant IA."
  },
  de: {
    metaTitle: "Spark — KI-Aufgabenplaner",
    metaDescription: "Spark ist dein KI-Aufgabenplaner. Milo hilft dir, zu priorisieren, zu planen und zu entscheiden, was heute ansteht. Starte kostenlos.",
    login: "Anmelden",
    badge: "KI-Aufgabenplaner",
    heroTitle: "Für wenn du weißt, was zu tun ist, aber nicht anfangen kannst.",
    heroText: "Spark wählt eine Aufgabe, teilt sie in Zwei-Minuten-Schritte und startet einen Timer. Gemacht für Köpfe, die beim Start hängen bleiben.",
    seePlans: "Pläne ansehen",
    noCard: "Keine Karte nötig. Jederzeit kündbar.",
    featuresTitle: "Alles, was du zum Organisieren brauchst",
    features: [
      { title: "Sagt dir, was zuerst dran ist", text: "Verbindet Priorität, Fälligkeit und verfügbare Zeit und wählt die eine Aufgabe, die jetzt am meisten Sinn ergibt." },
      { title: "Teilt sie in winzige Schritte", text: "Hängst du an etwas Großem? Milo teilt es in konkrete Aktionen, beginnend mit einer unter zwei Minuten." },
      { title: "Fokusmodus", text: "Eine Aufgabe, ein Schritt, ein Timer. Alles andere verschwindet vom Bildschirm." },
      { title: "Milo, dein Assistent", text: "Schreib oder sprich mit einer KI, die deine Liste kennt, im Web sucht und sich merkt, wie du arbeitest." }
    ],
    howTitle: "So funktioniert's",
    steps: [
      { title: "Schreib die Aufgabe auf", text: "Nur den Titel. Priorität und Datum sind optional." },
      { title: "Spark zerlegt sie", text: "Es wählt die, die jetzt zählt, und teilt sie in Schritte, die du anfangen kannst." },
      { title: "Drück auf Start", text: "Der Fokusmodus zeigt einen Schritt und einen Timer. Sonst nichts." }
    ],
    priceNote: "Referenzpreise in US-Dollar.",
    faqTitle: "Häufige Fragen",
    faqs: [
      { q: "Ist das für ADHS gemacht?", a: "Spark ist rund ums Anfangen gebaut – genau dort bleiben viele Menschen mit ADHS hängen: eine Aufgabe, winzige Schritte und ein sichtbarer Timer. Es ist ein Produktivitätswerkzeug, keine medizinische Behandlung und keine Diagnose." },
      { q: "Ist es kostenlos?", a: "Ja. Der Free-Plan kostet nichts und braucht keine Karte. Wenn du mehr willst, kannst du Plus 14 Tage kostenlos testen." },
      { q: "Kann ich jederzeit kündigen?", a: "Ja. Du kündigst jederzeit in deinem Konto und behältst deinen Plan bis zum Ende des bezahlten Zeitraums." },
      { q: "Wie bezahle ich?", a: "Zahlungen übernimmt Paddle, unser Merchant of Record: Paddle nimmt die Zahlung entgegen, erledigt die Umsatzsteuer und meldet sie an, du musst also nichts tun. Deine Kartendaten durchlaufen nie unsere Server." },
      { q: "Hat die KI immer recht?", a: "Nein. Milo ist eine Hilfe und kann sich irren: Prüfe Wichtiges, bevor du nach seinen Antworten handelst." },
      { q: "Was passiert mit meinen Daten?", a: "Deine Aufgaben gehören dir. Wir verkaufen deine Daten nicht und nutzen sie nicht für Werbung. Mehr in der Datenschutzerklärung." }
    ],
    finalTitle: "Starte heute, es ist kostenlos",
    finalCta: "Konto erstellen",
    appDescription: "Aufgabenplaner mit KI-Assistent."
  },
  it: {
    metaTitle: "Spark — Organizzatore di attività con IA",
    metaDescription: "Spark è il tuo organizzatore di attività con IA. Milo ti aiuta a dare priorità, pianificare e decidere cosa fare oggi. Inizia gratis.",
    login: "Accedi",
    badge: "Organizzatore di attività con IA",
    heroTitle: "Per quando sai cosa fare ma non riesci a iniziare.",
    heroText: "Spark sceglie una sola attività, la divide in passaggi da due minuti e avvia un timer. Fatto per cervelli che si bloccano alla partenza.",
    seePlans: "Vedi i piani",
    noCard: "Nessuna carta. Annulli quando vuoi.",
    featuresTitle: "Tutto ciò che serve per organizzarti",
    features: [
      { title: "Ti dice cosa fare per primo", text: "Incrocia priorità, scadenza e tempo disponibile per scegliere l'unica attività che conta adesso." },
      { title: "La divide in passaggi minimi", text: "Bloccato su qualcosa di grande? Milo lo divide in azioni concrete, a partire da una sotto i due minuti." },
      { title: "Modalità focus", text: "Un'attività, un passaggio, un timer. Tutto il resto sparisce dallo schermo." },
      { title: "Milo, il tuo assistente", text: "Scrivi o parla con un'IA che conosce la tua lista, cerca sul web e ricorda come lavori." }
    ],
    howTitle: "Come funziona",
    steps: [
      { title: "Scrivi l'attività", text: "Solo il titolo. Priorità e data sono facoltative." },
      { title: "Spark la smonta", text: "Sceglie quella che conta ora e la divide in passaggi che puoi davvero iniziare." },
      { title: "Premi avvia", text: "La modalità focus mostra un passaggio e un timer. Nient'altro." }
    ],
    priceNote: "Prezzi di riferimento in dollari statunitensi.",
    faqTitle: "Domande frequenti",
    faqs: [
      { q: "È pensato per l'ADHD?", a: "Spark è costruito intorno all'iniziare, il punto in cui molte persone con ADHD si bloccano: un'attività per volta, passaggi minimi e un timer in vista. È uno strumento di produttività, non un trattamento medico né una diagnosi." },
      { q: "È gratis?", a: "Sì. Il piano Free non ha costi e non richiede carta. Se vuoi di più, puoi provare Plus gratis per 14 giorni." },
      { q: "Posso annullare quando voglio?", a: "Sì. Annulli dal tuo account quando vuoi e mantieni il piano fino alla fine del periodo pagato." },
      { q: "Come si paga?", a: "I pagamenti sono gestiti da Paddle, il nostro merchant of record: incassa il pagamento, si occupa dell'imposta sulle vendite e la dichiara, così non devi fare nulla. I dati della tua carta non passano mai dai nostri server." },
      { q: "L'IA ha sempre ragione?", a: "No. Milo è un aiuto e può sbagliare: verifica le cose importanti prima di agire in base alle sue risposte." },
      { q: "Che succede ai miei dati?", a: "Le tue attività sono tue. Non vendiamo i tuoi dati né li usiamo per la pubblicità. Maggiori dettagli nell'Informativa sulla privacy." }
    ],
    finalTitle: "Inizia oggi, è gratis",
    finalCta: "Crea il mio account",
    appDescription: "Organizzatore di attività con assistente IA."
  },
  zh: {
    metaTitle: "Spark — AI 任务管理工具",
    metaDescription: "Spark 是你的 AI 任务管理工具。Milo 帮你排优先级、安排日程，并决定今天该做什么。免费开始。",
    login: "登录",
    badge: "AI 任务管理工具",
    heroTitle: "当你知道要做什么，却迟迟开不了头。",
    heroText: "Spark 只挑一件事，拆成两分钟的步骤，并开启计时器。为在起跑线前卡住的大脑而做。",
    seePlans: "查看方案",
    noCard: "无需绑卡，随时取消。",
    featuresTitle: "高效安排所需的一切",
    features: [
      { title: "告诉你先做什么", text: "综合优先级、截止日期和可用时间，挑出此刻最值得做的那一件事。" },
      { title: "拆成极小的步骤", text: "被大任务卡住了？Milo 会拆成具体行动，第一步不到两分钟。" },
      { title: "专注模式", text: "一件事、一个步骤、一个计时器，其余内容全部从屏幕上消失。" },
      { title: "Milo，你的助手", text: "用文字或语音与懂你清单的 AI 交流，它能联网搜索并记住你的工作方式。" }
    ],
    howTitle: "使用方法",
    steps: [
      { title: "写下任务", text: "只要标题。优先级和日期可选。" },
      { title: "Spark 帮你拆解", text: "它挑出此刻重要的那件事，并拆成你能真正开始的步骤。" },
      { title: "按下开始", text: "专注模式只显示一个步骤和一个计时器，别无其他。" }
    ],
    priceNote: "参考价格以美元计。",
    faqTitle: "常见问题",
    faqs: [
      { q: "适合 ADHD（多动症）吗？", a: "Spark 围绕「开始」而设计，而这正是许多 ADHD 人群卡住的地方：一次一件事、极小的步骤、看得见的计时器。它是效率工具，不是医疗手段，也不能用于诊断。" },
      { q: "免费吗？", a: "是的。Free 方案免费，无需绑卡。想要更多功能，可以免费试用 Plus 14 天。" },
      { q: "可以随时取消吗？", a: "可以。你可随时在账户中取消，并在已付费周期结束前继续使用当前方案。" },
      { q: "如何付款？", a: "支付由 Paddle 处理，它是我们的收款方：款项由其收取，销售税也由其申报，你无需操心。你的银行卡信息不会经过我们的服务器。" },
      { q: "AI 总是正确吗？", a: "不是。Milo 只是辅助工具，可能出错：依据其回答行动前，请核实重要信息。" },
      { q: "我的数据会怎样？", a: "你的任务归你所有。我们不会出售你的数据，也不会用于广告。详情见隐私政策。" }
    ],
    finalTitle: "今天就开始，免费使用",
    finalCta: "创建我的账户",
    appDescription: "带 AI 助手的任务管理工具。"
  },
  ja: {
    metaTitle: "Spark — AIタスク管理",
    metaDescription: "SparkはAIタスク管理アプリです。Miloが優先順位付けやスケジュール、今日やることの判断をサポートします。無料で始められます。",
    login: "ログイン",
    badge: "AIタスク管理",
    heroTitle: "やることは分かっているのに、始められないときに。",
    heroText: "Sparkは1件だけ選び、2分の手順に分け、タイマーを動かします。スタートで固まる頭のために作りました。",
    seePlans: "プランを見る",
    noCard: "カード不要。いつでも解約できます。",
    featuresTitle: "整理に必要なものがすべて揃っています",
    features: [
      { title: "何を最初にやるか教えます", text: "優先度・期限・使える時間を組み合わせ、今いちばん意味のある1件を選びます。" },
      { title: "ごく小さなステップに分解", text: "大きな作業で固まっていませんか。Miloが具体的な行動に分け、最初は2分未満から始めます。" },
      { title: "集中モード", text: "1つのタスク、1つのステップ、1つのタイマー。ほかはすべて画面から消えます。" },
      { title: "Milo、あなたのアシスタント", text: "リストを把握し、Web検索もでき、あなたの進め方を覚えるAIと文字でも音声でも話せます。" }
    ],
    howTitle: "使い方",
    steps: [
      { title: "タスクを書く", text: "タイトルだけで十分。優先度と日付は任意です。" },
      { title: "Sparkが分解する", text: "今いちばん大事な1件を選び、始められる手順に分けます。" },
      { title: "開始を押す", text: "集中モードは手順1つとタイマーだけを表示します。" }
    ],
    priceNote: "参考価格は米ドル表示です。",
    faqTitle: "よくある質問",
    faqs: [
      { q: "ADHDの人に向いていますか？", a: "Sparkは「始めること」を中心に作られています。ADHDの多くの人がつまずくのがそこだからです。1件ずつ、ごく小さな手順、見えるタイマー。あくまで生産性ツールで、医療的な治療や診断ではありません。" },
      { q: "無料ですか？", a: "はい。Freeプランは無料で、カードも不要です。さらに使いたい場合は、Plusを14日間無料で試せます。" },
      { q: "いつでも解約できますか？", a: "はい。アカウントからいつでも解約でき、支払い済みの期間の終わりまでプランを利用できます。" },
      { q: "支払い方法は？", a: "支払いは、当社のmerchant of recordであるPaddleが処理します。代金の回収も、売上税の計算と申告も、すべてPaddleが行うため、お客様が対応する必要はありません。カード情報は当社サーバーを経由しません。" },
      { q: "AIは常に正しいですか？", a: "いいえ。Miloは補助ツールで、間違うこともあります。重要なことは、回答に基づいて行動する前に確認してください。" },
      { q: "データはどうなりますか？", a: "タスクはあなたのものです。データを販売したり、広告に利用したりしません。詳細はプライバシーポリシーをご覧ください。" }
    ],
    finalTitle: "今日から始めよう、無料です",
    finalCta: "アカウントを作成",
    appDescription: "AIアシスタント付きタスク管理アプリ。"
  },
  ko: {
    metaTitle: "Spark — AI 할 일 관리",
    metaDescription: "Spark는 AI 할 일 관리 앱입니다. Milo가 우선순위 정리, 일정 등록, 오늘 할 일 결정을 도와드려요. 무료로 시작하세요.",
    login: "로그인",
    badge: "AI 할 일 관리",
    heroTitle: "무엇을 할지는 알지만 시작이 안 될 때.",
    heroText: "Spark는 한 가지만 골라 2분짜리 단계로 쪼개고 타이머를 켭니다. 출발선에서 멈추는 뇌를 위해 만들었어요.",
    seePlans: "요금제 보기",
    noCard: "카드 필요 없음. 언제든 해지할 수 있어요.",
    featuresTitle: "정리에 필요한 모든 것",
    features: [
      { title: "무엇부터 할지 알려줘요", text: "우선순위, 마감일, 가능한 시간을 종합해 지금 가장 의미 있는 한 가지를 골라요." },
      { title: "아주 작은 단계로 쪼개요", text: "큰 일 앞에서 멈췄나요? Milo가 구체적인 행동으로 나누고, 첫 단계는 2분이 안 걸려요." },
      { title: "집중 모드", text: "할 일 하나, 단계 하나, 타이머 하나. 나머지는 화면에서 사라져요." },
      { title: "Milo, 나의 어시스턴트", text: "내 목록을 알고 웹을 검색하며 내 방식을 기억하는 AI와 글이나 음성으로 대화해요." }
    ],
    howTitle: "이용 방법",
    steps: [
      { title: "할 일을 적어요", text: "제목만 있으면 돼요. 우선순위와 날짜는 선택이에요." },
      { title: "Spark가 쪼개요", text: "지금 중요한 하나를 고르고, 시작할 수 있는 단계로 나눠요." },
      { title: "시작을 눌러요", text: "집중 모드는 단계 하나와 타이머만 보여줘요." }
    ],
    priceNote: "참고 가격은 미국 달러 기준입니다.",
    faqTitle: "자주 묻는 질문",
    faqs: [
      { q: "ADHD에 도움이 되나요?", a: "Spark는 '시작하기'를 중심으로 만들었어요. ADHD가 있는 많은 분들이 막히는 지점이니까요. 한 번에 하나, 아주 작은 단계, 눈에 보이는 타이머. 생산성 도구일 뿐 의료적 치료나 진단은 아닙니다." },
      { q: "무료인가요?", a: "네. Free 요금제는 무료이며 카드가 필요 없습니다. 더 필요하시면 Plus를 14일간 무료로 체험할 수 있어요." },
      { q: "언제든 해지할 수 있나요?", a: "네. 계정에서 언제든 해지할 수 있고, 결제한 기간이 끝날 때까지 요금제를 이용할 수 있습니다." },
      { q: "결제는 어떻게 하나요?", a: "결제는 당사의 merchant of record인 Paddle이 처리합니다. 대금 수령, 세금 부과와 신고를 모두 담당하므로 따로 신경 쓰실 것이 없습니다. 카드 정보는 당사 서버를 거치지 않습니다." },
      { q: "AI가 항상 맞나요?", a: "아니요. Milo는 보조 도구이며 틀릴 수 있습니다. 중요한 내용은 답변에 따라 행동하기 전에 확인하세요." },
      { q: "내 데이터는 어떻게 되나요?", a: "할 일은 여러분의 것입니다. 데이터를 판매하거나 광고에 사용하지 않습니다. 자세한 내용은 개인정보 처리방침을 확인하세요." }
    ],
    finalTitle: "오늘 시작하세요, 무료입니다",
    finalCta: "계정 만들기",
    appDescription: "AI 어시스턴트가 있는 할 일 관리 앱."
  },
  ru: {
    metaTitle: "Spark — Планировщик задач с ИИ",
    metaDescription: "Spark — ваш планировщик задач с ИИ. Milo помогает расставлять приоритеты, планировать и решать, что делать сегодня. Начните бесплатно.",
    login: "Войти",
    badge: "Планировщик задач с ИИ",
    heroTitle: "Для тех случаев, когда знаешь, что делать, но не можешь начать.",
    heroText: "Spark выбирает одну задачу, делит её на двухминутные шаги и включает таймер. Сделано для голов, которые застревают на старте.",
    seePlans: "Смотреть тарифы",
    noCard: "Без карты. Отмена в любой момент.",
    featuresTitle: "Всё, что нужно для порядка в делах",
    features: [
      { title: "Подсказывает, с чего начать", text: "Учитывает приоритет, срок и свободное время и выбирает одну задачу, которая важнее всего сейчас." },
      { title: "Делит на крошечные шаги", text: "Застряли на чём-то большом? Milo разложит это на конкретные действия, начиная с шага меньше двух минут." },
      { title: "Режим фокуса", text: "Одна задача, один шаг, один таймер. Всё остальное исчезает с экрана." },
      { title: "Milo, ваш ассистент", text: "Пишите или говорите с ИИ, который знает ваш список, ищет в интернете и помнит, как вы работаете." }
    ],
    howTitle: "Как это работает",
    steps: [
      { title: "Запишите задачу", text: "Достаточно названия. Приоритет и дата — по желанию." },
      { title: "Spark её разбирает", text: "Выбирает ту, что важна сейчас, и делит на шаги, которые реально начать." },
      { title: "Нажмите старт", text: "Режим фокуса показывает один шаг и таймер. Больше ничего." }
    ],
    priceNote: "Ориентировочные цены указаны в долларах США.",
    faqTitle: "Частые вопросы",
    faqs: [
      { q: "Подходит ли это при СДВГ?", a: "Spark построен вокруг начала — именно здесь застревают многие люди с СДВГ: одна задача за раз, крошечные шаги и таймер на виду. Это инструмент продуктивности, а не лечение и не диагностика." },
      { q: "Это бесплатно?", a: "Да. Тариф Free бесплатный и не требует карты. Если хотите больше, можно бесплатно попробовать Plus в течение 14 дней." },
      { q: "Можно отменить в любой момент?", a: "Да. Вы отменяете подписку в аккаунте когда угодно и сохраняете тариф до конца оплаченного периода." },
      { q: "Как оплатить?", a: "Платежи обрабатывает Paddle, наш продавец от имени компании: он принимает оплату, берёт на себя налог с продаж и подаёт декларацию, так что вам ничего делать не нужно. Данные вашей карты не проходят через наши серверы." },
      { q: "ИИ всегда прав?", a: "Нет. Milo — это помощник, и он может ошибаться: проверяйте важное, прежде чем действовать по его ответам." },
      { q: "Что будет с моими данными?", a: "Ваши задачи принадлежат вам. Мы не продаём ваши данные и не используем их для рекламы. Подробнее — в Политике конфиденциальности." }
    ],
    finalTitle: "Начните сегодня — это бесплатно",
    finalCta: "Создать аккаунт",
    appDescription: "Планировщик задач с ИИ-ассистентом."
  },
  tr: {
    metaTitle: "Spark — Yapay zekâlı görev planlayıcı",
    metaDescription: "Spark, yapay zekâlı görev planlayıcınızdır. Milo önceliklendirmenize, planlamanıza ve bugün ne yapacağınıza karar vermenize yardımcı olur. Ücretsiz başlayın.",
    login: "Giriş yap",
    badge: "Yapay zekâlı görev planlayıcı",
    heroTitle: "Ne yapacağını bildiğin ama bir türlü başlayamadığın anlar için.",
    heroText: "Spark tek bir görev seçer, iki dakikalık adımlara böler ve zamanlayıcıyı başlatır. Başlangıçta takılan beyinler için yapıldı.",
    seePlans: "Planları gör",
    noCard: "Kart gerekmez. İstediğiniz zaman iptal edin.",
    featuresTitle: "Düzenlenmek için ihtiyacınız olan her şey",
    features: [
      { title: "Önce ne yapacağını söyler", text: "Öncelik, son tarih ve müsait zamanı birleştirip şu an en anlamlı olan tek görevi seçer." },
      { title: "Minik adımlara böler", text: "Büyük bir işte takıldın mı? Milo onu somut eylemlere böler, ilki iki dakikadan kısa." },
      { title: "Odak modu", text: "Tek görev, tek adım, tek zamanlayıcı. Geri kalan her şey ekrandan kaybolur." },
      { title: "Milo, asistanın", text: "Listeni bilen, web'de arayan ve nasıl çalıştığını hatırlayan bir yapay zekâyla yazışın ya da konuşun." }
    ],
    howTitle: "Nasıl çalışır",
    steps: [
      { title: "Görevi yaz", text: "Sadece başlık yeter. Öncelik ve tarih isteğe bağlı." },
      { title: "Spark onu parçalara ayırır", text: "Şu an önemli olanı seçer ve gerçekten başlayabileceğin adımlara böler." },
      { title: "Başlat'a bas", text: "Odak modu tek bir adım ve zamanlayıcı gösterir. Başka hiçbir şey." }
    ],
    priceNote: "Referans fiyatlar ABD doları cinsindendir.",
    faqTitle: "Sık sorulan sorular",
    faqs: [
      { q: "DEHB için uygun mu?", a: "Spark, başlamak üzerine kurulu: DEHB'li birçok kişinin takıldığı yer tam da orası. Tek seferde tek görev, minik adımlar ve görünür bir zamanlayıcı. Bu bir verimlilik aracıdır; tıbbi tedavi ya da teşhis değildir." },
      { q: "Ücretsiz mi?", a: "Evet. Free planı ücretsizdir ve kart istemez. Daha fazlasını isterseniz Plus'ı 14 gün ücretsiz deneyebilirsiniz." },
      { q: "İstediğim zaman iptal edebilir miyim?", a: "Evet. Hesabınızdan istediğiniz zaman iptal edebilir ve ödenen dönemin sonuna kadar planınızı kullanabilirsiniz." },
      { q: "Nasıl ödeme yaparım?", a: "Ödemeler, merchant of record olan Paddle tarafından işlenir: tahsilatı alır, satış vergisini yönetir ve beyanını yapar, böylece sizin bunlarla uğraşmanız gerekmez. Kart bilgileriniz sunucularımıza hiç uğramaz." },
      { q: "Yapay zekâ her zaman doğru mudur?", a: "Hayır. Milo bir yardımcıdır ve yanılabilir: yanıtlarına göre hareket etmeden önce önemli bilgileri doğrulayın." },
      { q: "Verilerime ne olur?", a: "Görevleriniz size aittir. Verilerinizi satmayız ve reklam için kullanmayız. Ayrıntılar Gizlilik Politikası'nda." }
    ],
    finalTitle: "Bugün başlayın, ücretsiz",
    finalCta: "Hesabımı oluştur",
    appDescription: "Yapay zekâ asistanlı görev planlayıcı."
  },
  nl: {
    metaTitle: "Spark — Taakplanner met AI",
    metaDescription: "Spark is jouw taakplanner met AI. Milo helpt je prioriteren, plannen en beslissen wat je vandaag doet. Begin gratis.",
    login: "Inloggen",
    badge: "Taakplanner met AI",
    heroTitle: "Voor als je weet wat je moet doen, maar niet kunt beginnen.",
    heroText: "Spark kiest één taak, hakt hem in stappen van twee minuten en zet een timer aan. Gemaakt voor hoofden die vastlopen bij de start.",
    seePlans: "Bekijk abonnementen",
    noCard: "Geen kaart nodig. Altijd opzegbaar.",
    featuresTitle: "Alles wat je nodig hebt om georganiseerd te blijven",
    features: [
      { title: "Zegt wat je eerst doet", text: "Combineert prioriteit, deadline en beschikbare tijd en kiest die ene taak die nu het meest zinvol is." },
      { title: "Hakt het in minuscule stappen", text: "Vastgelopen op iets groots? Milo splitst het in concrete acties, te beginnen met één onder de twee minuten." },
      { title: "Focusmodus", text: "Eén taak, één stap, één timer. Al het andere verdwijnt van het scherm." },
      { title: "Milo, je assistent", text: "Typ of praat met een AI die je lijst kent, op het web zoekt en onthoudt hoe jij werkt." }
    ],
    howTitle: "Zo werkt het",
    steps: [
      { title: "Schrijf de taak op", text: "Alleen de titel. Prioriteit en datum zijn optioneel." },
      { title: "Spark haalt hem uit elkaar", text: "Het kiest wat nu telt en hakt het in stappen waar je aan kunt beginnen." },
      { title: "Druk op start", text: "De focusmodus toont één stap en een timer. Verder niets." }
    ],
    priceNote: "Referentieprijzen in Amerikaanse dollars.",
    faqTitle: "Veelgestelde vragen",
    faqs: [
      { q: "Is het gemaakt voor ADHD?", a: "Spark is gebouwd rond beginnen, precies waar veel mensen met ADHD vastlopen: één taak tegelijk, minuscule stappen en een zichtbare timer. Het is een productiviteitstool, geen medische behandeling of diagnose." },
      { q: "Is het gratis?", a: "Ja. Het Free-abonnement kost niets en vraagt geen kaart. Wil je meer, dan kun je Plus 14 dagen gratis proberen." },
      { q: "Kan ik altijd opzeggen?", a: "Ja. Je zegt op in je account wanneer je wilt en houdt je abonnement tot het einde van de betaalde periode." },
      { q: "Hoe betaal ik?", a: "Betalingen worden afgehandeld door Paddle, onze merchant of record: Paddle ontvangt het bedrag, regelt de btw en doet daarvan aangifte, zodat jij je daar niet mee hoeft te bemoeien. Je gegevens van je kaart komen nooit op onze servers." },
      { q: "Heeft de AI altijd gelijk?", a: "Nee. Milo is een hulpmiddel en kan zich vergissen: controleer belangrijke dingen voordat je op de antwoorden handelt." },
      { q: "Wat gebeurt er met mijn gegevens?", a: "Je taken zijn van jou. We verkopen je gegevens niet en gebruiken ze niet voor reclame. Meer details in het Privacybeleid." }
    ],
    finalTitle: "Begin vandaag, het is gratis",
    finalCta: "Mijn account aanmaken",
    appDescription: "Taakplanner met AI-assistent."
  },
  pl: {
    metaTitle: "Spark — Organizer zadań z AI",
    metaDescription: "Spark to Twój organizer zadań z AI. Milo pomaga ustalać priorytety, planować i decydować, co zrobić dziś. Zacznij za darmo.",
    login: "Zaloguj się",
    badge: "Organizer zadań z AI",
    heroTitle: "Na chwile, gdy wiesz, co zrobić, ale nie możesz zacząć.",
    heroText: "Spark wybiera jedno zadanie, dzieli je na dwuminutowe kroki i włącza minutnik. Zrobiony dla głów, które grzęzną na starcie.",
    seePlans: "Zobacz plany",
    noCard: "Bez karty. Anuluj, kiedy chcesz.",
    featuresTitle: "Wszystko, czego potrzebujesz do organizacji",
    features: [
      { title: "Mówi, co zrobić najpierw", text: "Łączy priorytet, termin i dostępny czas, by wybrać jedno zadanie, które teraz ma największy sens." },
      { title: "Dzieli je na malutkie kroki", text: "Utknąłeś przy czymś dużym? Milo dzieli to na konkretne działania, zaczynając od kroku poniżej dwóch minut." },
      { title: "Tryb skupienia", text: "Jedno zadanie, jeden krok, jeden minutnik. Reszta znika z ekranu." },
      { title: "Milo, Twój asystent", text: "Pisz lub mów do AI, która zna Twoją listę, szuka w sieci i pamięta, jak pracujesz." }
    ],
    howTitle: "Jak to działa",
    steps: [
      { title: "Zapisz zadanie", text: "Wystarczy tytuł. Priorytet i data są opcjonalne." },
      { title: "Spark je rozkłada", text: "Wybiera to, co ważne teraz, i dzieli na kroki, które da się zacząć." },
      { title: "Naciśnij start", text: "Tryb skupienia pokazuje jeden krok i minutnik. Nic więcej." }
    ],
    priceNote: "Ceny orientacyjne w dolarach amerykańskich.",
    faqTitle: "Najczęstsze pytania",
    faqs: [
      { q: "Czy nadaje się przy ADHD?", a: "Spark jest zbudowany wokół zaczynania — właśnie tam grzęźnie wiele osób z ADHD: jedno zadanie naraz, malutkie kroki i widoczny minutnik. To narzędzie do produktywności, nie leczenie ani diagnoza." },
      { q: "Czy to jest darmowe?", a: "Tak. Plan Free jest bezpłatny i nie wymaga karty. Jeśli chcesz więcej, możesz przetestować Plus przez 14 dni za darmo." },
      { q: "Czy mogę anulować w dowolnym momencie?", a: "Tak. Anulujesz w swoim koncie, kiedy chcesz, i zachowujesz plan do końca opłaconego okresu." },
      { q: "Jak zapłacić?", a: "Płatności obsługuje Paddle, nasz merchant of record: pobiera pieniądze, zajmuje się podatkiem od sprzedaży i rozlicza go, więc nie musisz się tym martwić. Dane Twojej karty nigdy nie trafiają na nasze serwery." },
      { q: "Czy AI zawsze ma rację?", a: "Nie. Milo jest pomocą i może się mylić: sprawdzaj ważne rzeczy, zanim zadziałasz na podstawie jego odpowiedzi." },
      { q: "Co dzieje się z moimi danymi?", a: "Twoje zadania należą do Ciebie. Nie sprzedajemy Twoich danych ani nie używamy ich do reklam. Więcej w Polityce prywatności." }
    ],
    finalTitle: "Zacznij dziś, to nic nie kosztuje",
    finalCta: "Utwórz konto",
    appDescription: "Organizer zadań z asystentem AI."
  }
};

// Headings shown above the Clerk forms (Clerk's own header is hidden by lib/clerk-appearance.ts).
export const authHeadings: Record<AppLanguage, { signIn: string; signUp: string }> = {
  en: { signIn: "Log in", signUp: "Create your account" },
  es: { signIn: "Inicia sesión", signUp: "Crea tu cuenta" },
  pt: { signIn: "Entrar", signUp: "Crie sua conta" },
  fr: { signIn: "Connexion", signUp: "Créez votre compte" },
  de: { signIn: "Anmelden", signUp: "Konto erstellen" },
  it: { signIn: "Accedi", signUp: "Crea il tuo account" },
  zh: { signIn: "登录", signUp: "创建账户" },
  ja: { signIn: "ログイン", signUp: "アカウント作成" },
  ko: { signIn: "로그인", signUp: "계정 만들기" },
  ru: { signIn: "Вход", signUp: "Создайте аккаунт" },
  tr: { signIn: "Giriş yap", signUp: "Hesap oluştur" },
  nl: { signIn: "Inloggen", signUp: "Account aanmaken" },
  pl: { signIn: "Zaloguj się", signUp: "Utwórz konto" }
};

export const sendLabels: Record<AppLanguage, string> = {
  en: "Send", es: "Enviar", pt: "Enviar", fr: "Envoyer", de: "Senden", it: "Invia",
  zh: "发送", ja: "送信", ko: "보내기", ru: "Отправить", tr: "Gönder", nl: "Verzenden", pl: "Wyślij"
};

// Sample content for the product preview on the landing page.
export const demoCopy: Record<AppLanguage, { rec: string; reason: string; steps: string[] }> = {
  en: { rec: "Prepare client presentation", reason: "High priority, due in 2 days. Long task, so starting now avoids a last-minute rush.", steps: ["Open the empty slide template", "Type the three section titles", "Paste this quarter's numbers"] },
  es: { rec: "Preparar la presentación del cliente", reason: "Prioridad alta y vence en 2 días. Es larga, así que empezar ahora evita correr a último momento.", steps: ["Abre la plantilla de diapositivas vacía", "Escribe los tres títulos de las secciones", "Pega los números de este trimestre"] },
  pt: { rec: "Preparar a apresentação do cliente", reason: "Prioridade alta e vence em 2 dias. É longa, então começar agora evita a correria.", steps: ["Abra o modelo de slides vazio", "Escreva os três títulos das seções", "Cole os números deste trimestre"] },
  fr: { rec: "Préparer la présentation client", reason: "Priorité haute, échéance dans 2 jours. Longue tâche : commencer maintenant évite la course.", steps: ["Ouvre le modèle de diapositives vide", "Écris les trois titres de sections", "Colle les chiffres de ce trimestre"] },
  de: { rec: "Kundenpräsentation vorbereiten", reason: "Hohe Priorität, in 2 Tagen fällig. Lange Aufgabe – jetzt anfangen vermeidet Stress.", steps: ["Öffne die leere Folienvorlage", "Tippe die drei Abschnittstitel", "Füge die Zahlen dieses Quartals ein"] },
  it: { rec: "Preparare la presentazione per il cliente", reason: "Priorità alta, scade tra 2 giorni. È lunga: iniziare ora evita la corsa finale.", steps: ["Apri il modello di diapositive vuoto", "Scrivi i tre titoli delle sezioni", "Incolla i numeri di questo trimestre"] },
  zh: { rec: "准备客户演示文稿", reason: "优先级高，2 天后到期。任务较长，现在开始可避免临时赶工。", steps: ["打开空白幻灯片模板", "输入三个章节标题", "粘贴本季度的数据"] },
  ja: { rec: "クライアント向けプレゼンの準備", reason: "優先度が高く期限は2日後。長い作業なので、今始めれば直前に慌てません。", steps: ["空のスライドテンプレートを開く", "3つの見出しを入力する", "今四半期の数字を貼り付ける"] },
  ko: { rec: "고객 발표 자료 준비", reason: "우선순위가 높고 마감은 2일 뒤. 오래 걸리니 지금 시작하면 덜 급해요.", steps: ["빈 슬라이드 템플릿을 여세요", "세 개의 섹션 제목을 쓰세요", "이번 분기 숫자를 붙여넣으세요"] },
  ru: { rec: "Подготовить презентацию для клиента", reason: "Высокий приоритет, срок через 2 дня. Задача долгая, лучше начать сейчас.", steps: ["Откройте пустой шаблон слайдов", "Впишите три заголовка разделов", "Вставьте цифры этого квартала"] },
  tr: { rec: "Müşteri sunumunu hazırla", reason: "Yüksek öncelikli, 2 gün içinde bitiyor. Uzun bir iş, şimdi başlamak telaşı önler.", steps: ["Boş slayt şablonunu aç", "Üç bölüm başlığını yaz", "Bu çeyreğin rakamlarını yapıştır"] },
  nl: { rec: "Klantpresentatie voorbereiden", reason: "Hoge prioriteit, over 2 dagen klaar. Lange taak, dus nu beginnen voorkomt haast.", steps: ["Open het lege diasjabloon", "Typ de drie sectietitels", "Plak de cijfers van dit kwartaal"] },
  pl: { rec: "Przygotować prezentację dla klienta", reason: "Wysoki priorytet, termin za 2 dni. To długie zadanie, lepiej zacząć teraz.", steps: ["Otwórz pusty szablon slajdów", "Wpisz trzy tytuły sekcji", "Wklej dane z tego kwartału"] }
};
