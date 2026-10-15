import "server-only";
import { NextResponse } from "next/server";
import { requireAuth, getUserPlanRow, planRowFrom } from "@/lib/server-auth";
import { resolveTrialView, resolveUserPlan, type UserPlan } from "@/lib/subscription-plans";

export async function GET() {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await getUserPlanRow(userId);
  if (!row) {
    return NextResponse.json({ plan: "free", trialEndsAt: null, trialAvailable: true, trialEnded: false, subscription: null });
  }

  const trialEndsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
  const now = new Date();
  const { plan, trialAvailable, trialEnded } = resolveTrialView(
    {
      // Paddle accounts use the same decision every API route makes
      // (getUserPlan): a past_due account whose paid period ended must not look
      // Plus here either. Everyone else keeps the raw plan, because
      // resolveTrialView needs it to notice that a trial has ended.
      plan: row.paddle_status ? resolveUserPlan(planRowFrom(row), now) : (row.plan as UserPlan),
      trialEndsAt,
      mpPreapprovalId: row.mp_preapproval_id
    },
    now
  );

  return NextResponse.json({
    plan,
    trialEndsAt: trialEndsAt !== null && trialEndsAt < now ? null : trialEndsAt?.toISOString() ?? null,
    trialAvailable,
    trialEnded,
    // What the settings screen shows. Null for accounts that never paid through Paddle.
    subscription: row.paddle_status
      ? {
          status: row.paddle_status as string,
          currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
          cancelAtPeriodEnd: row.cancel_at_period_end === true,
          canManage: Boolean(row.paddle_customer_id)
        }
      : null
  });
}
