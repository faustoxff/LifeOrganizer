import { auth } from "@clerk/nextjs/server";
import { AuthGate } from "@/components/auth-gate";
import { KnowledgePage } from "@/components/knowledge-page";

export default async function Knowledge() {
  await auth.protect();
  return (
    <AuthGate>
      <KnowledgePage />
    </AuthGate>
  );
}
