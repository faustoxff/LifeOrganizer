"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { useAppLanguage } from "@/components/language-provider";
import {
  createInitialRecommendedTaskHelpState,
  RecommendedTaskHelp,
  type RecommendedTaskHelpState
} from "@/components/recommended-task-help";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Typewriter } from "@/components/ui/typewriter";
import { useTimer } from "@/components/ui/timer";
import { formatDueDate, getDueDateLabel } from "@/lib/task-date";
import { getTaskDurationLabel } from "@/lib/task-labels";
import { cn } from "@/lib/utils";
import { Task } from "@/types/task";

type RecommendationCardProps = {
  hasPendingTasks: boolean;
  isAiLoading: boolean;
  recommendationReason: string;
  recommendedTask: Task | null;
  statusMessage: string;
};

export function RecommendationCard({
  hasPendingTasks,
  isAiLoading,
  recommendationReason,
  recommendedTask,
  statusMessage
}: RecommendationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [helpState, setHelpState] = useState<RecommendedTaskHelpState>(() =>
    createInitialRecommendedTaskHelpState()
  );
  const timer = useTimer();

  useEffect(() => {
    if (!recommendedTask) {
      setIsExpanded(false);
    }
    timer.reset();
  }, [recommendedTask?.id]);

  useEffect(() => {
    setHelpState(createInitialRecommendedTaskHelpState());
  }, [recommendedTask?.id]);

  useEffect(() => {
    if (!isExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsExpanded(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExpanded]);

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-lg">
        <RecommendationCardContent
          hasPendingTasks={hasPendingTasks}
          isAiLoading={isAiLoading}
          isExpanded={false}
          onExpand={recommendedTask ? () => setIsExpanded(true) : undefined}
          helpState={helpState}
          onHelpStateChange={setHelpState}
          recommendationReason={recommendationReason}
          recommendedTask={recommendedTask}
          statusMessage={statusMessage}
          timer={timer}
        />
      </section>

      {isExpanded && recommendedTask ? (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 backdrop-blur-sm sm:p-6">
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-7">
              <ExpandedHeader task={recommendedTask} onClose={() => setIsExpanded(false)} />
            </div>
            <div className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              <RecommendationCardContent
                hasPendingTasks={hasPendingTasks}
                isAiLoading={isAiLoading}
                isExpanded
                onExpand={undefined}
                helpState={helpState}
                onHelpStateChange={setHelpState}
                recommendationReason={recommendationReason}
                recommendedTask={recommendedTask}
                statusMessage={statusMessage}
                timer={timer}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ExpandedHeader({ onClose, task }: { onClose: () => void; task: Task }) {
  const { copy } = useAppLanguage();
  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {copy.recommendation.expandedView}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{task.title}</h2>
      </div>
      <Button variant="outline" size="sm" onClick={onClose} type="button">
        {copy.common.close}
      </Button>
    </>
  );
}

type RecommendationCardContentProps = RecommendationCardProps & {
  helpState: RecommendedTaskHelpState;
  isExpanded: boolean;
  onExpand?: () => void;
  onHelpStateChange: Dispatch<SetStateAction<RecommendedTaskHelpState>>;
  timer: ReturnType<typeof useTimer>;
};

function RecommendationCardContent({
  hasPendingTasks,
  helpState,
  isAiLoading,
  isExpanded,
  onExpand,
  onHelpStateChange,
  recommendationReason,
  recommendedTask,
  statusMessage,
  timer
}: RecommendationCardContentProps) {
  const { copy, language } = useAppLanguage();
  const heading = recommendedTask
    ? recommendedTask.title
    : hasPendingTasks
      ? isAiLoading
        ? copy.recommendation.awaitingAiTitle
        : copy.recommendation.unavailableTitle
      : copy.common.noPendingTasks;

  return (
    <div className={cn("flex flex-col", isExpanded ? "gap-8" : "gap-6")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className={isExpanded ? "max-w-3xl" : undefined}>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {copy.common.todayRecommendation}
          </p>
          <h2
            className={cn(
              "mt-2 font-semibold tracking-tight",
              isExpanded ? "text-4xl sm:text-5xl" : "text-2xl"
            )}
          >
            {heading}
          </h2>
          {recommendationReason ? (
            <p
              className={cn(
                "mt-3 text-muted-foreground",
                isExpanded ? "max-w-3xl text-base leading-7 sm:text-lg" : "text-sm leading-6 sm:text-base"
              )}
            >
              <Typewriter key={recommendationReason} text={recommendationReason} />
            </p>
          ) : isAiLoading && hasPendingTasks ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <span className="loading-dot" />
                <span className="loading-dot loading-dot-delay-1" />
                <span className="loading-dot loading-dot-delay-2" />
                <span className="ml-1">{copy.recommendation.buildExplanation}</span>
              </div>
              <div className="h-2 w-full max-w-[28rem] overflow-hidden rounded-full bg-border">
                <div className="loading-shimmer h-full rounded-full" />
              </div>
            </div>
          ) : statusMessage ? (
            <p
              className={cn(
                "mt-3 text-muted-foreground",
                isExpanded ? "text-base leading-7 sm:text-lg" : "text-sm leading-6 sm:text-base"
              )}
            >
              {statusMessage}
            </p>
          ) : null}
        </div>

        {onExpand ? (
          <Button variant="outline" size="sm" onClick={onExpand} type="button">
            {copy.recommendation.openLarge}
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          "grid gap-4 rounded-xl bg-primary/10 border border-primary/20",
          isExpanded ? "p-5 sm:grid-cols-4" : "p-4 sm:grid-cols-3"
        )}
      >
        <MetaItem label={copy.recommendation.category} value={recommendedTask ? recommendedTask.category : "-"} />
        <MetaItem
          label={copy.recommendation.priority}
          value={recommendedTask ? copy.taskForm.priorities[recommendedTask.priority] : "-"}
        />
        <MetaItem
          label={copy.recommendation.duration}
          value={recommendedTask ? getTaskDurationLabel(recommendedTask.estimateMin) : "-"}
        />
        {isExpanded ? (
          <MetaItem
            label={copy.recommendation.dueDate}
            value={
              recommendedTask
                ? `${getDueDateLabel(recommendedTask.dueDate, language)} · ${formatDueDate(recommendedTask.dueDate, language)}`
                : "-"
            }
          />
        ) : null}
      </div>

      {isExpanded && recommendedTask?.description ? (
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {copy.recommendation.description}
          </p>
          <p className="mt-3 text-sm leading-7 sm:text-base">
            {recommendedTask.description}
          </p>
        </Card>
      ) : null}

      {recommendedTask ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant={timer.isRunning ? "outline" : "default"}
            onClick={timer.isRunning ? timer.stop : timer.start}
          >
            {timer.isRunning ? "⏸ Pausar" : timer.elapsedMs > 0 ? "▶ Continuar" : "▶ Empezar tarea"}
          </Button>
          {timer.elapsedMs > 0 && (
            <>
              <span className="font-mono text-base tabular-nums">{timer.formattedTime}</span>
              {!timer.isRunning && (
                <Button size="sm" variant="ghost" onClick={timer.reset}>Reset</Button>
              )}
            </>
          )}
        </div>
      ) : null}

      {recommendedTask ? (
        <RecommendedTaskHelp
          onStateChange={onHelpStateChange}
          recommendationReason={recommendationReason}
          state={helpState}
          task={recommendedTask}
          uiLanguage={language}
        />
      ) : null}
    </div>
  );
}

type MetaItemProps = {
  label: string;
  value: string;
};

function MetaItem({ label, value }: MetaItemProps) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-sm font-medium sm:text-base">{value}</p>
    </div>
  );
}
