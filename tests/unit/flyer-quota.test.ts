import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    flyerGenerationLog: {
      count: mocks.count,
      create: mocks.create,
    },
  },
}));

import {
  assertFlyerQuota,
  FLYER_ANONYMOUS_LIMIT,
  FLYER_DRAFT_LIMIT,
  readFlyerQuota,
  recordFlyerGeneration,
} from "@/modules/flyers/lib/quota";

const DRAFT_KEY = "11111111-2222-4333-8444-555555555555";
const TOKEN_HASH = "a".repeat(64);
const USER_ID = "99999999-8888-4777-8666-555555555555";

const loggedIn = { userId: USER_ID, ownerTokenHash: TOKEN_HASH };
const anonymous = { userId: null, ownerTokenHash: TOKEN_HASH };

beforeEach(() => {
  mocks.count.mockReset();
  mocks.create.mockReset();
});

describe("readFlyerQuota", () => {
  it("ログイン済みは下書き単位で 3 回まで", async () => {
    mocks.count.mockResolvedValue(2);
    const quota = await readFlyerQuota(DRAFT_KEY, loggedIn);
    expect(quota).toEqual({
      limit: FLYER_DRAFT_LIMIT,
      used: 2,
      remaining: 1,
      anonymous: false,
    });
    expect(mocks.count).toHaveBeenCalledWith({
      where: { draftKey: DRAFT_KEY },
    });
  });

  it("未ログインは下書きではなく端末通算 1 回まで", async () => {
    mocks.count.mockResolvedValue(0);
    const quota = await readFlyerQuota(DRAFT_KEY, anonymous);
    expect(quota.remaining).toBe(FLYER_ANONYMOUS_LIMIT);
    expect(quota.anonymous).toBe(true);
    expect(mocks.count).toHaveBeenCalledWith({
      where: { ownerTokenHash: TOKEN_HASH },
    });
  });
});

describe("assertFlyerQuota", () => {
  it("下書きの上限に達したら 403", async () => {
    mocks.count.mockResolvedValue(FLYER_DRAFT_LIMIT);
    await expect(assertFlyerQuota(DRAFT_KEY, loggedIn)).rejects.toMatchObject({
      status: 403,
      extras: { error: "FLYER_QUOTA_EXCEEDED" },
    });
  });

  it("未ログインで 1 回使ったら会員登録を促す 403", async () => {
    mocks.count.mockResolvedValue(FLYER_ANONYMOUS_LIMIT);
    await expect(assertFlyerQuota(DRAFT_KEY, anonymous)).rejects.toMatchObject({
      status: 403,
      extras: { error: "REGISTER_REQUIRED" },
    });
  });

  it("まだ使っていなければ通る", async () => {
    mocks.count.mockResolvedValue(0);
    const quota = await assertFlyerQuota(DRAFT_KEY, loggedIn);
    expect(quota.remaining).toBe(FLYER_DRAFT_LIMIT);
  });
});

describe("recordFlyerGeneration", () => {
  it("下書き・所有者・選択内容を 1 行で残す", async () => {
    mocks.create.mockResolvedValue({});
    await recordFlyerGeneration({
      draftKey: DRAFT_KEY,
      owner: anonymous,
      templateId: "style_1_bar_stylish",
      layoutId: "top_stack",
      paletteId: "gold",
      flyerAssetId: "asset-id",
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        draftKey: DRAFT_KEY,
        userId: null,
        ownerTokenHash: TOKEN_HASH,
        templateId: "style_1_bar_stylish",
        layoutId: "top_stack",
        paletteId: "gold",
        flyerAssetId: "asset-id",
      },
    });
  });
});
