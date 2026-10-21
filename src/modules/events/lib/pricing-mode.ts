import { ProblemDetailException } from "@/lib/exceptions";
import { pricingModeOf } from "@/modules/events/types";

type Audience = "ANY" | "MALE" | "FEMALE";

/**
 * 料金の編集可否を判定する。
 * 下書きはまだ回答を受け付けないため常に編集できる。公開・受付停止のあとで
 * 出席者がいるときは、共通／男女別の切り替えと、出席者が選んでいるプランの
 * 削除・対象変更を止める（participants.pricePlanId が SetNull で消えるため）。
 */
export function assertPricingEditable(
  existing: {
    status: "DRAFT" | "PUBLISHED" | "CLOSED";
    participants: { status: "ATTENDING" | "DECLINED"; pricePlanId: string | null }[];
    pricePlans: { id: string; audience: Audience }[];
  },
  input: { pricePlans: { id?: string; audience: Audience }[] },
): void {
  if (existing.status === "DRAFT") return;
  const attending = existing.participants.filter((row) => row.status === "ATTENDING");
  if (attending.length === 0) return;

  const modeChanged = pricingModeOf(existing.pricePlans) !== pricingModeOf(input.pricePlans);
  const submitted = new Map(
    input.pricePlans.flatMap((row) => (row.id ? [[row.id, row] as const] : [])),
  );
  const usedPlanIds = new Set(
    attending.flatMap((row) => (row.pricePlanId ? [row.pricePlanId] : [])),
  );
  const usedBroken = existing.pricePlans.some((plan) => {
    if (!usedPlanIds.has(plan.id)) return false;
    const next = submitted.get(plan.id);
    return !next || next.audience !== plan.audience;
  });

  if (!modeChanged && !usedBroken) return;
  throw new ProblemDetailException({
    status: 409,
    title: "Pricing Locked",
    detail: `出席者が${attending.length}名いるため、料金の共通・男女別の切り替えや、選ばれているプランの削除はできません。金額・プラン名・補足は変更できます。`,
    error: "PRICING_LOCKED",
  });
}
