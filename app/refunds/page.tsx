import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { LEGAL } from "@/lib/legal-config";
import { refundsContent } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Política de reembolsos · Spark" };

export default function RefundsPage() {
  return <LegalDocument content={refundsContent} lastUpdated={LEGAL.lastUpdated} />;
}
