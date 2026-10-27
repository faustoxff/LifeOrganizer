"use client";

import Link from "next/link";
import { useAppLanguage } from "@/components/language-provider";

export function LegalLinks({ className = "" }: { className?: string }) {
  const { language } = useAppLanguage();
  const es = language === "es";
  return (
    <nav className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground ${className}`}>
      <Link href="/terms" className="hover:underline">
        {es ? "Términos y condiciones" : "Terms of Service"}
      </Link>
      <Link href="/privacy" className="hover:underline">
        {es ? "Política de privacidad" : "Privacy Policy"}
      </Link>
      <Link href="/refunds" className="hover:underline">
        {es ? "Reembolsos" : "Refunds"}
      </Link>
    </nav>
  );
}

export function SignUpConsent() {
  const { language } = useAppLanguage();
  const es = language === "es";
  return (
    <p className="mt-4 max-w-sm text-center text-xs text-[hsl(220,8%,60%)]">
      {es ? "Al crear tu cuenta aceptas los " : "By creating an account you accept the "}
      <Link href="/terms" className="underline">
        {es ? "Términos y condiciones" : "Terms of Service"}
      </Link>
      {es ? " y la " : " and the "}
      <Link href="/privacy" className="underline">
        {es ? "Política de privacidad" : "Privacy Policy"}
      </Link>
      .
    </p>
  );
}
