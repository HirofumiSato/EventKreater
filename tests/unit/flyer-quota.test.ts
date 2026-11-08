import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  createMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    flyerGenerationLog: {
      count: mocks.count,
      createMany: mocks.createMany,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  assertFlyerQuota,
  attachFlyerAssetToLog,
  attributePendingFlyerLogs,
  FLYER_ANONYMOUS_LIMIT,
  FLYER_DRAFT_LIMIT,
  readFlyerQuota,
  recordFlyerCandidates,
  type FlyerQuotaScope,
} from "@/modules/flyers/lib/quota";
import { flyerQuotaLabel } from "@/modules/flyers/lib/quota-label";

const EVENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CANDIDATE_ID = "0f6a2c6e-6f2a-4c1a-9f3e-6e2b0f3a1c11";
const TOKEN_HASH = "a".repeat(64);
const USER_ID = "99999999-8888-4777-8666-555555555555";

const loggedIn = { userId: USER_ID, ownerTokenHash: TOKEN_HASH };
const anonymous = { userId: null, ownerTokenHash: TOKEN_HASH };
const newDraft: FlyerQuotaScope = { eventId: null };
const eventScope: FlyerQuotaScope = { eventId: EVENT_ID };

function candidate(source: string) {
  return {
    candidateId: CANDIDATE_ID,
    templateId: "style_1_bar_stylish",
    layoutId: "top_stack",
    paletteId: "gold",
    source,
  };
}

beforeEach(() => {
  mocks.count.mockReset();
  mocks.createMany.mockReset();
  mocks.updateMany.mockReset();
});

describe("readFlyerQuota", () => {
  it("ログイン済みの新規作成は event_id が空の AI 背景を会員単位で数える", async () => {
    mocks.count.mockResolvedValue(2);
    const quota = await readFlyerQuota(newDraft, loggedIn);
    expect(quota).toEqual({
      limit: FLYER_DRAFT_LIMIT,
      used: 2,
      remaining: 1,
      anonymous: false,
    });
    // 保存前は会員に結び付け、付け替え済みの行を二重に数えない。
    expect(mocks.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, eventId: null, source: "ai" },
    });
  });

  it("未ログインは端末通算 1 回までで、AI 背景だけを数える", async () => {
    mocks.count.mockResolvedValue(0);
    const quota = await readFlyerQuota(newDraft, anonymous);
    expect(quota.remaining).toBe(FLYER_ANONYMOUS_LIMIT);
    expect(quota.anonymous).toBe(true);
    expect(mocks.count).toHaveBeenCalledWith({
      where: { ownerTokenHash: TOKEN_HASH, eventId: null, source: "ai" },
    });
  });

  it("保存済みイベントは端末や会員に関係なくイベント単位で数える", async () => {
    mocks.count.mockResolvedValue(2);
    // ゲスト幹事（未ログイン）でも、イベントの枠は 3 枚で未ログイン扱いにしない。
    const quota = await readFlyerQuota(eventScope, anonymous);
    expect(quota).toEqual({
      limit: FLYER_DRAFT_LIMIT,
      used: 2,
      remaining: 1,
      anonymous: false,
    });
    expect(mocks.count).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, source: "ai" },
    });
  });

  it("共同主催者の端末が変わっても同じイベント枠を数える", async () => {
    mocks.count.mockResolvedValue(1);
    await readFlyerQuota(eventScope, loggedIn);
    expect(mocks.count).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, source: "ai" },
    });
  });
});

describe("assertFlyerQuota", () => {
  it("会員の新規作成で上限に達したら 403", async () => {
    mocks.count.mockResolvedValue(FLYER_DRAFT_LIMIT);
    await expect(assertFlyerQuota(newDraft, loggedIn)).rejects.toMatchObject({
      status: 403,
      extras: { error: "FLYER_QUOTA_EXCEEDED" },
    });
  });

  it("イベントの上限に達したら共同主催者も 403", async () => {
    mocks.count.mockResolvedValue(FLYER_DRAFT_LIMIT);
    await expect(assertFlyerQuota(eventScope, anonymous)).rejects.toMatchObject({
      status: 403,
      extras: { error: "FLYER_QUOTA_EXCEEDED" },
    });
  });

  it("未ログインで 1 枚使ったら会員登録を促す 403", async () => {
    mocks.count.mockResolvedValue(FLYER_ANONYMOUS_LIMIT);
    await expect(assertFlyerQuota(newDraft, anonymous)).rejects.toMatchObject({
      status: 403,
      extras: { error: "REGISTER_REQUIRED" },
    });
  });

  it("まだ使っていなければ通る", async () => {
    mocks.count.mockResolvedValue(0);
    const quota = await assertFlyerQuota(newDraft, loggedIn);
    expect(quota.remaining).toBe(FLYER_DRAFT_LIMIT);
  });
});

describe("recordFlyerCandidates", () => {
  it("AI の候補を 1 枚 1 行で記録し、その枚数だけ消費する", async () => {
    // 書き込む直前の数え直しと、記録後の数え直し。
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    mocks.createMany.mockResolvedValue({ count: 2 });

    const quota = await recordFlyerCandidates({
      scope: newDraft,
      owner: loggedIn,
      candidates: [candidate("ai"), candidate("ai")],
    });

    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        {
          candidateId: CANDIDATE_ID,
          source: "ai",
          eventId: null,
          userId: USER_ID,
          ownerTokenHash: TOKEN_HASH,
          templateId: "style_1_bar_stylish",
          layoutId: "top_stack",
          paletteId: "gold",
        },
        {
          candidateId: CANDIDATE_ID,
          source: "ai",
          eventId: null,
          userId: USER_ID,
          ownerTokenHash: TOKEN_HASH,
          templateId: "style_1_bar_stylish",
          layoutId: "top_stack",
          paletteId: "gold",
        },
      ],
    });
    expect(quota).toEqual({
      limit: FLYER_DRAFT_LIMIT,
      used: 2,
      remaining: 1,
      anonymous: false,
    });
  });

  it("placeholder は記録するだけで消費しない", async () => {
    mocks.count.mockResolvedValue(0);
    mocks.createMany.mockResolvedValue({ count: 1 });

    const quota = await recordFlyerCandidates({
      scope: newDraft,
      owner: loggedIn,
      candidates: [candidate("placeholder")],
    });

    // AI が 0 枚なら書き込む前の数え直しをせず、消費も起きない。
    expect(mocks.count).toHaveBeenCalledTimes(1);
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        {
          candidateId: CANDIDATE_ID,
          source: "placeholder",
          eventId: null,
          userId: USER_ID,
          ownerTokenHash: TOKEN_HASH,
          templateId: "style_1_bar_stylish",
          layoutId: "top_stack",
          paletteId: "gold",
        },
      ],
    });
    expect(quota.remaining).toBe(FLYER_DRAFT_LIMIT);
  });

  it("AI の枚数が残りを超えるなら、記録せず 403 にする", async () => {
    mocks.count.mockResolvedValue(2);

    await expect(
      recordFlyerCandidates({
        scope: newDraft,
        owner: loggedIn,
        candidates: [candidate("ai"), candidate("ai")],
      }),
    ).rejects.toMatchObject({
      status: 403,
      extras: { error: "FLYER_QUOTA_EXCEEDED" },
    });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("未ログインで 1 枚の枠を超えるなら、会員登録を促す 403 にする", async () => {
    mocks.count.mockResolvedValue(0);

    await expect(
      recordFlyerCandidates({
        scope: newDraft,
        owner: anonymous,
        candidates: [candidate("ai"), candidate("ai")],
      }),
    ).rejects.toMatchObject({
      status: 403,
      extras: { error: "REGISTER_REQUIRED" },
    });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});

describe("attachFlyerAssetToLog", () => {
  it("まだ保存していない候補を、作ったチラシへ結ぶ", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await attachFlyerAssetToLog({
      scope: newDraft,
      owner: loggedIn,
      candidateId: CANDIDATE_ID,
      flyerAssetId: "asset-id",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        eventId: null,
        candidateId: CANDIDATE_ID,
        flyerAssetId: null,
      },
      data: { flyerAssetId: "asset-id" },
    });
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("イベントの枠では会員や端末ではなくイベントで候補を絞る", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await attachFlyerAssetToLog({
      scope: eventScope,
      owner: anonymous,
      candidateId: CANDIDATE_ID,
      flyerAssetId: "asset-id",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, candidateId: CANDIDATE_ID, flyerAssetId: null },
      data: { flyerAssetId: "asset-id" },
    });
  });

  it("同じ候補を二重に保存しようとすると 409 CANDIDATE_ALREADY_SAVED", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.count.mockResolvedValue(1);

    await expect(
      attachFlyerAssetToLog({
        scope: newDraft,
        owner: loggedIn,
        candidateId: CANDIDATE_ID,
        flyerAssetId: "asset-id",
      }),
    ).rejects.toMatchObject({
      status: 409,
      extras: { error: "CANDIDATE_ALREADY_SAVED" },
    });
  });

  it("他人の候補や消えた候補は 409 CANDIDATE_NOT_FOUND", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.count.mockResolvedValue(0);

    await expect(
      attachFlyerAssetToLog({
        scope: newDraft,
        owner: loggedIn,
        candidateId: CANDIDATE_ID,
        flyerAssetId: "asset-id",
      }),
    ).rejects.toMatchObject({
      status: 409,
      extras: { error: "CANDIDATE_NOT_FOUND" },
    });
  });
});

describe("attributePendingFlyerLogs", () => {
  it("公開前の会員の履歴をイベントの枠へ付け替える", async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 });

    const count = await attributePendingFlyerLogs(USER_ID, EVENT_ID);

    expect(count).toBe(2);
    // 端末（未ログイン）の履歴は会員へ引き継がない。会員の未確定の行だけを動かす。
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, eventId: null },
      data: { eventId: EVENT_ID },
    });
  });

  it("未確定の履歴が無ければ 0 を返す", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    expect(await attributePendingFlyerLogs(USER_ID, EVENT_ID)).toBe(0);
  });
});

describe("flyerQuotaLabel", () => {
  it("新規作成は背景を作る枚数として示す", () => {
    expect(
      flyerQuotaLabel({ limit: 3, used: 2, remaining: 1, anonymous: false }),
    ).toBe("背景を作れるのは、残り 1 枚（最大 3 枚）");
  });

  it("保存済みイベントはイベント単位であることを示す", () => {
    expect(
      flyerQuotaLabel(
        { limit: 3, used: 1, remaining: 2, anonymous: false },
        { eventScoped: true },
      ),
    ).toBe("このイベントで背景を作れるのは、残り 2 枚（最大 3 枚）");
  });

  it("未ログインは端末通算であることを示す", () => {
    expect(
      flyerQuotaLabel({ limit: 1, used: 1, remaining: 0, anonymous: true }),
    ).toBe("未ログインで背景を作れるのは、残り 0 枚（最大 1 枚）");
  });
});
