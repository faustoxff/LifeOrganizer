import type { AppLanguage } from "@/lib/i18n";
import { getTaskPriorityLabel } from "@/lib/task-labels";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";

export function PriorityPill({ priority, language }: { priority: Task["priority"]; language: AppLanguage }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        priority === "high" && "bg-red-500/15 text-red-400",
        priority === "medium" && "bg-amber-500/15 text-amber-400",
        priority === "low" && "bg-muted/60 text-muted-foreground"
      )}
    >
      {getTaskPriorityLabel(priority, language)}
    </span>
  );
}
