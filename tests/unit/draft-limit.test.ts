import { describe, expect, it } from "vitest";
import {
  DRAFT_EVENT_LIMIT_FREE,
  DRAFT_EVENT_LIMIT_MONTHLY_8,
  DRAFT_EVENT_LIMIT_UNLIMITED,
  draftEventLimitOf,
} from "@/modules/billing/lib/plans";
import { assertCanSaveDraft } from "@/modules/billing/lib/quota";

/**
 * `assertCanSaveDraft` は DB の2つの問い合わせ（利用枠の行と下書きの件数）だけを使う。
 * 単体では、その2つを返す最小の代役を渡して、403 を組み立てる経路を直接呼ぶ。
 * 実際のテーブルと行ロックは結合テスト（`tests/integration/draft-limit.test.ts`）で見る。
 */
type DraftDb = Parameters<typeof assertCanSaveDraft>[0];

interface QuotaRow {
  subscriptionStatus: "NONE" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";
  subscriptionPlan: "NONE" | "MONTHLY_8" | "UNLIMITED";
  currentPeriodEnd: Date | null;
  paidCredits: number;
}

const USER_ID = "11111111-2222-4333-8444-555555555555";
const FUTURE = new Date("2099-12-31T00:00:00.000Z");

const MONTHLY_8: QuotaRow = {
  subscriptionStatus: "ACTIVE",
  subscriptionPlan: "MONTHLY_8",
  currentPeriodEnd: FUTURE,
  paidCredits: 0,
};

const UNLIMITED: QuotaRow = {
  subscriptionStatus: "ACTIVE",
  subscriptionPlan: "UNLIMITED",
  currentPeriodEnd: FUTURE,
  paidCredits: 0,
};

function fakeDb(quota: QuotaRow | null, draftCount: number): DraftDb {
  return {
    userUsageQuota: { findUnique: async () => quota },
    event: { count: async () => draftCount },
  } as unknown as DraftDb;
}

describe("下書きの件数上限", () => {
  it("無料は3件、980円は10件、放題は30件", () => {
    expect(draftEventLimitOf("free")).toBe(DRAFT_EVENT_LIMIT_FREE);
    expect(draftEventLimitOf("monthly-8")).toBe(DRAFT_EVENT_LIMIT_MONTHLY_8);
    expect(draftEventLimitOf("unlimited")).toBe(DRAFT_EVENT_LIMIT_UNLIMITED);
  });

  it("単発クレジットを1枚以上持つ未加入の人は、980円と同じ10件", () => {
    expect(draftEventLimitOf("free", true)).toBe(DRAFT_EVENT_LIMIT_MONTHLY_8);
    // 1枚も持っていなければ無料と同じ3件。
    expect(draftEventLimitOf("free", false)).toBe(DRAFT_EVENT_LIMIT_FREE);
  });

  it("上限に達したら 403 DRAFT_LIMIT_REACHED で、文言に上限の件数を入れる", async () => {
    await expect(assertCanSaveDraft(fakeDb(null, DRAFT_EVENT_LIMIT_FREE), USER_ID)).rejects.toMatchObject({
      status: 403,
      detail: expect.stringContaining(`下書きは${DRAFT_EVENT_LIMIT_FREE}件までです`),
      extras: { error: "DRAFT_LIMIT_REACHED", draftLimit: DRAFT_EVENT_LIMIT_FREE },
    });
  });

  it("上限に満たなければ通る", async () => {
    await expect(
      assertCanSaveDraft(fakeDb(null, DRAFT_EVENT_LIMIT_FREE - 1), USER_ID),
    ).resolves.toBeUndefined();
  });

  it("980円は10件目まで通り、11件目で止まる", async () => {
    await expect(assertCanSaveDraft(fakeDb(MONTHLY_8, 9), USER_ID)).resolves.toBeUndefined();
    await expect(assertCanSaveDraft(fakeDb(MONTHLY_8, 10), USER_ID)).rejects.toMatchObject({
      status: 403,
      extras: { error: "DRAFT_LIMIT_REACHED", draftLimit: DRAFT_EVENT_LIMIT_MONTHLY_8 },
    });
  });

  it("放題は30件目まで通り、31件目で止まる", async () => {
    await expect(assertCanSaveDraft(fakeDb(UNLIMITED, 29), USER_ID)).resolves.toBeUndefined();
    await expect(assertCanSaveDraft(fakeDb(UNLIMITED, 30), USER_ID)).rejects.toMatchObject({
      status: 403,
      extras: { error: "DRAFT_LIMIT_REACHED", draftLimit: DRAFT_EVENT_LIMIT_UNLIMITED },
    });
  });
});
