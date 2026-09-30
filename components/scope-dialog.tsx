"use client";

import { useEffect, useRef } from "react";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import type { EditScope } from "@/lib/task-validation";

/**
 * Pregunta el alcance cuando se edita o se borra una ocurrencia de una serie:
 * solo esa, o esa y las siguientes.
 */
export function ScopeDialog({
  action,
  onChoose,
  onCancel
}: {
  action: "edit" | "delete";
  onChoose: (scope: EditScope) => void;
  onCancel: () => void;
}) {
  const { copy } = useAppLanguage();
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButton.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const title = action === "edit" ? copy.scope.editTitle : copy.scope.deleteTitle;
  const question = action === "edit" ? copy.scope.editQuestion : copy.scope.deleteQuestion;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scope-dialog-title"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg"
      >
        <h2 id="scope-dialog-title" className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{question}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button ref={firstButton} type="button" variant="outline" onClick={() => onChoose("this")}>
            {copy.scope.thisOnly}
          </Button>
          <Button type="button" variant={action === "delete" ? "destructive" : "default"} onClick={() => onChoose("following")}>
            {copy.scope.thisAndFollowing}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {copy.common.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
