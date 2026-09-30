"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle, Loader2, Mic, MicOff, Repeat, Send, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { MiloLoader } from "@/components/milo-loader";
import { sendLabels } from "@/lib/landing-copy";
import { useAppLanguage } from "@/components/language-provider";
import { MiloAvatar } from "@/components/milo-avatar";
import { micCopy } from "@/lib/focus-copy";
import { type MiloFace } from "@/lib/milo-face";
import { describeRepeat } from "@/lib/repeat-label";
import { formatDueDate } from "@/lib/task-date";
import { getTaskPriorityLabel } from "@/lib/task-labels";
import { useVoiceInput } from "@/lib/use-voice-input";
import { cn } from "@/lib/utils";
import { WeekProposalCard } from "@/components/week-proposal-card";
import type { FactProposal, SavedFact, WeekProposal } from "@/types/milo";
import { Task, TaskInput } from "@/types/task";
import { useUser } from "@clerk/nextjs";

function briefingKey(userId: string) {
  // Scoped per account so a shared computer never mixes one user's briefing with another's.
  return `milo_last_briefing_${userId}`;
}
const LEGACY_SESSION_PREFIX = "milo_session_";

function renderMarkdown(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    const parts: React.ReactNode[] = [];
    let rest = line;

    // listas con - o *
    const listMatch = rest.match(/^(\s*[-*]\s+)(.*)/);
    if (listMatch) {
      rest = listMatch[2];
      parts.push(<span key="bullet" className="mr-1 text-muted-foreground">•</span>);
    }

    // negrita **text** e itálica *text*
    const segments = rest.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    for (const seg of segments) {
      if (seg.startsWith("**") && seg.endsWith("**")) {
        parts.push(<strong key={seg}>{seg.slice(2, -2)}</strong>);
      } else if (seg.startsWith("*") && seg.endsWith("*")) {
        parts.push(<em key={seg}>{seg.slice(1, -1)}</em>);
      } else {
        parts.push(seg);
      }
    }

    return <div key={i}>{parts}</div>;
  });
}

type Message = {
  role: "user" | "milo";
  content: string;
  taskActions?: TaskInput[];
  /** Solo cuando Milo armó la semana: se muestra como tarjeta por día en vez de lista. */
  proposal?: WeekProposal;
  /** Lo que Milo guardó porque el usuario lo dijo. */
  factsSaved?: SavedFact[];
  /** Lo que Milo dedujo: no está guardado hasta que el usuario lo confirma. */
  factProposals?: Array<FactProposal & { state?: "saving" | "saved" | "error" }>;
  taskCreated?: boolean;
};

type PersistedMessage = Pick<Message, "role" | "content">;

type MiloCopy = {
  briefingGoodMorning: string;
  briefingGoodAfternoon: string;
  briefingGoodEvening: string;
  briefingNoPending: string;
  briefingPending: (n: number) => string;
  briefingUrgent: (n: number, names: string) => string;
  briefingCompleted: (n: number) => string;
  briefingHelp: string;
};

function getGreetingByHour(miloCopy: MiloCopy): string {
  const hour = new Date().getHours();
  // Late night (00:00-04:59) counts as "evening/night", not morning.
  if (hour >= 5 && hour < 12) return miloCopy.briefingGoodMorning;
  if (hour >= 12 && hour < 19) return miloCopy.briefingGoodAfternoon;
  return miloCopy.briefingGoodEvening;
}

function buildDailyBriefing(tasks: Task[], miloCopy: MiloCopy): string {
  const pending = tasks.filter((t) => !t.done);
  const urgent = pending.filter((t) => t.priority === "high");
  const today = new Date();
  const completedToday = tasks.filter((t) => {
    if (!t.done || !t.completedAt) return false;
    return new Date(t.completedAt).toDateString() === today.toDateString();
  });

  const lines: string[] = [getGreetingByHour(miloCopy)];

  if (pending.length === 0) {
    lines.push(miloCopy.briefingNoPending);
  } else {
    lines.push(miloCopy.briefingPending(pending.length));
    if (urgent.length > 0) {
      const urgentNames = urgent.slice(0, 2).map((t) => t.title).join(", ");
      lines.push(miloCopy.briefingUrgent(urgent.length, urgentNames + (urgent.length > 2 ? "..." : "")));
    }
  }

  if (completedToday.length > 0) {
    lines.push(miloCopy.briefingCompleted(completedToday.length));
  }

  lines.push(miloCopy.briefingHelp);
  return lines.join("\n");
}

export function MiloChat({
  tasks,
  onCreateTask,
  onTasksChanged
}: {
  tasks: Task[];
  onCreateTask: (input: TaskInput) => Promise<boolean>;
  /** Milo reacomodó o fijó tareas (replan_now, pin_task): hay que recargarlas. */
  onTasksChanged?: () => void;
}) {
  const { copy, language } = useAppLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  // Only used so a dictated message can grab the focus; the height is the
  // Textarea's own business.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceInput(language);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const { user } = useUser();
  const userId = user?.id ?? "";
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const briefingSentRef = useRef(false);
  const tasksLoadedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Ítems pendientes de confirmación (los de la última propuesta sin confirmar ni descartar).
  // Van al servidor completos para que Milo pueda cambiarlos si el usuario lo pide.
  const pendingTaskActions = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.taskActions && m.taskActions.length > 0 && !m.taskCreated) return m.taskActions;
    }
    return [];
  }, [messages]);

  const overloadedTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.done || t.priority !== "high") return false;
      const daysUntil = Math.ceil((new Date(t.dueDate).getTime() - Date.now()) / 86400000);
      return daysUntil <= 2;
    });
  }, [tasks]);

  const isOverloaded = overloadedTasks.length >= 3;

  const isEmpty = messages.length === 0 && !isLoading;
  const headerFace: MiloFace = voice.state === "recording"
    ? "escuchando"
    : isLoading
      ? "pensando"
      : isOverloaded
        ? "alerta"
        : "avatar";

  // The conversation stays in memory for this session only. Milo still remembers
  // the user through the server-side summary, but old text never reappears here.
  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.removeItem(LEGACY_SESSION_PREFIX + userId);
    } catch {
      /* storage can be blocked */
    }
    setSessionLoaded(true);
  }, [userId]);

  // Briefing diario
  useEffect(() => {
    if (!sessionLoaded || briefingSentRef.current) return;
    if (tasks.length === 0 && !tasksLoadedRef.current) return;
    tasksLoadedRef.current = true;

    const lastBriefing = localStorage.getItem(briefingKey(userId));
    const today = new Date().toISOString().split("T")[0];
    if (lastBriefing === today) return;

    briefingSentRef.current = true;
    localStorage.setItem(briefingKey(userId), today);
    setMessages((prev) => [...prev, { role: "milo", content: buildDailyBriefing(tasks, copy.milo) }]);
  }, [sessionLoaded, tasks, userId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isLoading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsLoading(true);

    try {
      const history = messages
        .filter((m) => m.role === "user" || m.role === "milo")
        .map(({ role, content }) => ({ role, content }));

      const response = await fetch("/api/milo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, tasks, history, pendingTaskActions })
      });

      const data = (await response.json()) as {
        response?: string;
        error?: string;
        taskActions?: TaskInput[];
        proposal?: WeekProposal | null;
        factsSaved?: SavedFact[];
        factProposals?: FactProposal[];
        tasksChanged?: boolean;
      };
      if (data.tasksChanged) onTasksChanged?.();

      const hasActions = Boolean(data.taskActions && data.taskActions.length > 0);
      const newMessage: Message = {
        role: "milo",
        content: data.response ?? data.error ?? copy.milo.noConnection,
        ...(hasActions ? { taskActions: data.taskActions } : {}),
        ...(hasActions && data.proposal ? { proposal: data.proposal } : {}),
        ...(data.factsSaved && data.factsSaved.length > 0 ? { factsSaved: data.factsSaved } : {}),
        ...(data.factProposals && data.factProposals.length > 0 ? { factProposals: data.factProposals } : {})
      };
      // Una propuesta nueva reemplaza a la anterior sin confirmar (por ejemplo, cuando el
      // usuario pidió un cambio): dos tarjetas con botones apuntando a lo mismo, una de
      // ellas vieja, es la forma más fácil de crear todo dos veces.
      setMessages((prev) => [
        ...(hasActions ? prev.map((m) => (m.taskActions ? { ...m, taskActions: undefined, proposal: undefined } : m)) : prev),
        newMessage
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "milo", content: copy.milo.noConnection }]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirmTask(msgIndex: number, actions: TaskInput[]) {
    setIsCreatingTask(true);
    try {
      // `onCreateTask` returns false when the task was rejected — the free
      // plan's 15-task cap, or any transport error. Setting `taskCreated: true`
      // regardless put a green "Task created" over a task that never existed,
      // while the failure banner said the opposite underneath it. Milo must not
      // claim a creation that did not happen.
      const results: boolean[] = [];
      for (const action of actions) {
        results.push(await onCreateTask(action));
      }
      const created = results.length > 0 && results.every(Boolean);
      // Lo que sí se creó no vuelve a ofrecerse: reintentar con todo el lote duplicaría
      // las que ya existen. La tarjeta semanal se reemplaza por la lista de lo que falta.
      const remaining = actions.filter((_, idx) => !results[idx]);
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIndex
            ? {
                ...m,
                taskActions: created ? undefined : remaining,
                proposal: created || remaining.length !== actions.length ? undefined : m.proposal,
                taskCreated: created
              }
            : m
        )
      );
    } finally {
      setIsCreatingTask(false);
    }
  }

  // Confirmar un hecho que Milo dedujo: recién acá se guarda.
  async function handleConfirmFact(msgIndex: number, key: string) {
    const patch = (state: "saving" | "saved" | "error") =>
      setMessages((prev) =>
        prev.map((m, i) => (i === msgIndex ? { ...m, factProposals: m.factProposals?.map((f) => (f.key === key ? { ...f, state } : f)) } : m))
      );
    const proposal = messages[msgIndex]?.factProposals?.find((f) => f.key === key);
    if (!proposal) return;
    patch("saving");
    try {
      const res = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: proposal.key, value: proposal.value, confidence: proposal.confidence })
      });
      patch(res.ok ? "saved" : "error");
    } catch {
      patch("error");
    }
  }

  function handleDismissFact(msgIndex: number, key: string) {
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIndex ? { ...m, factProposals: m.factProposals?.filter((f) => f.key !== key) } : m))
    );
  }

  function handleDismissTask(msgIndex: number) {
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIndex ? { ...m, taskActions: undefined, proposal: undefined } : m))
    );
  }

  function clearMessages() {
    setMessages([]);
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-border">
      {/* Header */}
      <div className="flex h-[68px] flex-shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-shrink-0">
            <MiloAvatar face={headerFace} size={36} alt="Milo" />
          </div>
          <div>
            <p className="text-lg font-semibold leading-7 tracking-tight">{copy.milo.name}</p>
            <p className="text-xs leading-4 text-muted-foreground">{copy.milo.subtitle}</p>
          </div>
        </div>
        <button
          onClick={clearMessages}
          disabled={messages.length === 0}
          className="flex items-center gap-1 rounded-md p-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
          aria-label={copy.milo.clearChat}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Overload warning */}
      {isOverloaded && (
        <div className="flex-shrink-0 border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {copy.milo.urgentWarning(overloadedTasks.length)}
        </div>
      )}

      {/* Messages */}
      <div
        className={cn(
          "min-h-0 flex-1 px-4 py-4",
          // Empty: centre the greeting and take scrolling away entirely, so
          // there is neither a track nor a wheel that moves nothing.
          isEmpty ? "flex items-center justify-center overflow-hidden" : "space-y-3 overflow-y-auto"
        )}
      >
        {isEmpty && sessionLoaded && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <div className="max-w-[220px] text-center">
              <MiloAvatar face="saludando" size={80} alt="Milo" className="mx-auto mb-3" />
              <p className="text-sm font-medium">{copy.milo.greeting}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {copy.milo.greetingSubtitle}
              </p>
            </div>
          </motion.div>
        )}

        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}
          >
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                msg.role === "user"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-secondary text-foreground"
              )}
            >
              {msg.role === "milo" ? renderMarkdown(msg.content) : msg.content}
            </div>

            {msg.taskActions && msg.taskActions.length > 0 && msg.proposal && (
              <WeekProposalCard
                proposal={msg.proposal}
                count={msg.taskActions.length}
                disabled={isCreatingTask}
                onConfirm={() => void handleConfirmTask(i, msg.taskActions!)}
                onDismiss={() => handleDismissTask(i)}
              />
            )}

            {msg.taskActions && msg.taskActions.length > 0 && !msg.proposal && (
              <div className="mt-2 max-w-[85%] w-full rounded-xl border border-border bg-card p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  {msg.taskActions.length === 1 ? copy.milo.createTask : `${copy.milo.createTask} (${msg.taskActions.length})`}
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {msg.taskActions.map((action, idx) => (
                    <div key={idx} className="rounded-lg bg-background/60 px-2.5 py-1.5">
                      <p className="text-sm font-medium text-foreground">{action.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {action.kind && action.kind !== "task" ? `${copy.taskForm.kinds[action.kind]} · ` : ""}
                        {action.category} · {getTaskPriorityLabel(action.priority, language)} · {formatDueDate(action.dueDate, language)}
                        {action.time ? ` · ${action.time}` : ""}
                      </p>
                      {action.repeat && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-primary/90">
                          <Repeat className="h-3 w-3" />
                          {describeRepeat(action.repeat, language, {
                            repeatOptions: copy.taskForm.repeatOptions,
                            repeatEvery: copy.taskForm.repeatEvery,
                            repeatWeeks: copy.taskForm.repeatWeeks,
                            repeatDays: copy.taskForm.repeatDays,
                            repeatMonths: copy.taskForm.repeatMonths
                          }, action.dueDate)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void handleConfirmTask(i, msg.taskActions!)}
                    disabled={isCreatingTask}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <CheckCircle className="h-3 w-3" />
                    {copy.milo.confirm}
                  </button>
                  <button
                    onClick={() => handleDismissTask(i)}
                    disabled={isCreatingTask}
                    className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <XCircle className="h-3 w-3" />
                    {copy.milo.dismiss}
                  </button>
                </div>
              </div>
            )}

            {msg.factsSaved?.map((fact) => (
              <div key={`saved-${fact.key}`} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" data-testid="fact-saved">
                <CheckCircle className="h-3 w-3 text-primary" />
                {copy.facts.remembered}: {fact.value}
              </div>
            ))}

            {msg.factProposals?.map((fact) => (
              <div key={`proposal-${fact.key}`} className="mt-2 w-full max-w-[85%] space-y-1.5 rounded-xl border border-border bg-card p-3" data-testid="fact-proposal">
                <p className="text-xs font-semibold text-foreground">{copy.facts.proposal}</p>
                <p className="text-sm">
                  <span className="text-muted-foreground">{fact.key.replace(/_/g, " ")}: </span>
                  {fact.value}
                </p>
                {fact.state === "saved" ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle className="h-3 w-3 text-primary" /> {copy.facts.saved}
                  </p>
                ) : (
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      onClick={() => void handleConfirmFact(i, fact.key)}
                      disabled={fact.state === "saving"}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <CheckCircle className="h-3 w-3" />
                      {copy.facts.save}
                    </button>
                    <button
                      onClick={() => handleDismissFact(i, fact.key)}
                      disabled={fact.state === "saving"}
                      className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <XCircle className="h-3 w-3" />
                      {copy.facts.dismiss}
                    </button>
                    {fact.state === "error" && <span className="text-xs text-destructive">{copy.facts.error}</span>}
                  </div>
                )}
              </div>
            ))}

            {msg.taskCreated && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle className="h-3 w-3 text-green-500" />
                {copy.milo.taskCreated}
              </div>
            )}
          </motion.div>
        ))}

        <AnimatePresence>
          {isLoading && (
            <motion.div
              className="flex justify-start"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="rounded-2xl rounded-bl-sm bg-secondary px-4 py-3">
                <MiloLoader />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        {voice.error && (
          <p className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            {micCopy[language][
              voice.error === "blocked"
                ? "blocked"
                : voice.error === "too-long"
                  ? "tooLong"
                  : voice.error === "limit"
                    ? "limit"
                    : voice.error === "failed"
                      ? "failed"
                      : "noSpeech"
            ]}
            <button onClick={voice.clearError} aria-label={copy.common.close} className="opacity-70 hover:opacity-100">
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={
              voice.state === "recording"
                ? micCopy[language].recording
                : voice.state === "transcribing"
                  ? micCopy[language].transcribing
                  : copy.milo.inputPlaceholder
            }
            disabled={isLoading || voice.state !== "idle"}
            className="min-h-11 max-h-32 flex-1 resize-none py-3 text-base sm:text-sm"
          />
          {voice.isSupported && (
            <Button
              type="button"
              onClick={() =>
                voice.state === "recording"
                  ? voice.stop()
                  : void voice.start((text) => {
                      setInput((prev) => (prev ? `${prev} ${text}` : text));
                      // The transcript only lands once Whisper is done, by
                      // which point the focus has wandered. Hand it back so the
                      // dictated text can be read, corrected or sent.
                      composerRef.current?.focus();
                    })
              }
              disabled={isLoading || voice.state === "transcribing"}
              variant={voice.state === "recording" ? "default" : "outline"}
              size="icon"
              aria-label={voice.state === "recording" ? copy.milo.stopListening : copy.milo.startListening}
              className={cn(voice.state === "recording" && "animate-pulse")}
            >
              {voice.state === "transcribing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : voice.state === "recording" ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            onClick={() => void sendMessage()}
            disabled={isLoading || !input.trim()}
            size="icon"
            aria-label={sendLabels[language]}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
