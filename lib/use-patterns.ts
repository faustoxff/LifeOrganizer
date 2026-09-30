"use client";

import { useEffect, useRef, useState } from "react";
import type { UserPatterns } from "@/lib/user-patterns";

/**
 * Lo que Spark aprendió del usuario, para mostrar la pista al estimar. Se pide una sola vez,
 * cuando `enabled` pasa a true (al abrir el formulario). Si falla, no hay pista: es un extra.
 */
export function usePatterns(enabled: boolean): UserPatterns | null {
  const [patterns, setPatterns] = useState<UserPatterns | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    fetch("/api/patterns")
      .then((res) => (res.ok ? (res.json() as Promise<{ patterns?: UserPatterns }>) : null))
      .then((data) => {
        if (data?.patterns) setPatterns(data.patterns);
      })
      .catch(() => {});
  }, [enabled]);

  return patterns;
}
