import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    flyerGenerationLog: {
      count: mocks.count,
      create: mocks.create,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  assertFlyerQuota,
  attributeFlyerLogsToEvent,
  FLYER_ANONYMOUS_LIMIT,
  FLYER_DRAFT_LIMIT,
  readFlyerQuota,
  recordFlyerGeneration,
  type FlyerQuotaScope,
} from "@/modules/flyers/lib/quota";
import { flyerQuotaLabel } from "@/modules/flyers/lib/quota-label";

const DRAFT_KEY = "11111111-2222-4333-8444-555555555555";
const EVENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN_HASH = "a".repeat(64);
const USER_ID = "99999999-8888-4777-8666-555555555555";

const loggedIn = { userId: USER_ID, ownerTokenHash: TOKEN_HASH };
const anonymous = { userId: null, ownerTokenHash: TOKEN_HASH };
const newDraft: FlyerQuotaScope = { draftKey: DRAFT_KEY, eventId: null };
const eventScope: FlyerQuotaScope = { draftKey: DRAFT_KEY, eventId: EVENT_ID };

beforeEach(() => {
  mocks.count.mockReset();
  mocks.create.mockReset();
  mocks.updateMany.mockReset();
});

describe("readFlyerQuota", () => {
  it("ログイン済みの新規作成は下書き単位で 3 回まで", async () => {
    mocks.count.mockResolvedValue(2);
    const quota = await readFlyerQuota(newDraft, loggedIn);
    expect(quota).toEqual({
      limit: FLYER_DRAFT_LIMIT,
      used: 2,
      remaining: 1,
      anonymous: false,
    });
    expect(mocks.count).toHaveBeenCalledWith({
      where: { draftKey: DRAFT_KEY, eventId: null },
    });
  });

  it("未ログインは下書きではなく端末通算 1 回まで", async () => {
    mocks.count.mockResolvedValue(0);
    const quota = await readFlyerQuota(newDraft, anonymous);
    expect(quota.remaining).toBe(FLYER_ANONYMOUS_LIMIT);
    expect(quota.anonymous).toBe(true);
    expect(mocks.count).toHaveBeenCalledWith({
      where: { ownerTokenHash: TOKEN_HASH },
    });
  });

  it("保存済みイベントは端末や下書きに関係なくイベント単位で数える", async () => {
    mocks.count.mockResolvedValue(2);
    // ゲスト幹事（未ログイン）でも、イベントの枠は 3 回で未ログイン扱いにしない。
    const quota = await readFlyerQuota(eventScope, anonymous);
    expect(quota).toEqual({
      limit: FLYER_DRAFT_LIMIT,
      used: 2,
      remaining: 1,
      anonymous: false,
    });
    expect(mocks.count).toHaveBeenCalledWith({ where: { eventId: EVENT_ID } });
  });

  it("共同主催者が別の下書き ID で保存しても同じイベント枠を数える", async () => {
    mocks.count.mockResolvedValue(1);
    const otherDraft: FlyerQuotaScope = {
      draftKey: "22222222-3333-4444-8555-666666666666",
      eventId: EVENT_ID,
    };
    await readFlyerQuota(otherDraft, loggedIn);
    expect(mocks.count).toHaveBeenCalledWith({ where: { eventId: EVENT_ID } });
  });
});

describe("assertFlyerQuota", () => {
  it("下書きの上限に達したら 403", async () => {
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

  it("未ログインで 1 回使ったら会員登録を促す 403", async () => {
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

describe("recordFlyerGeneration", () => {
  it("ログイン済みの新規作成は event_id を空で残す", async () => {
    mocks.create.mockResolvedValue({});
    await recordFlyerGeneration({
      scope: newDraft,
      owner: loggedIn,
      templateId: "style_1_bar_stylish",
      layoutId: "top_stack",
      paletteId: "gold",
      flyerAssetId: "asset-id",
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        draftKey: DRAFT_KEY,
        eventId: null,
        userId: USER_ID,
        ownerTokenHash: TOKEN_HASH,
        templateId: "style_1_bar_stylish",
        layoutId: "top_stack",
        paletteId: "gold",
        flyerAssetId: "asset-id",
      },
    });
  });

  it("保存済みイベントは event_id を残す", async () => {
    mocks.create.mockResolvedValue({});
    await recordFlyerGeneration({
      scope: eventScope,
      owner: anonymous,
      templateId: "style_1_bar_stylish",
      layoutId: "top_stack",
      paletteId: "gold",
      flyerAssetId: "asset-id",
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        draftKey: DRAFT_KEY,
        eventId: EVENT_ID,
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

describe("attributeFlyerLogsToEvent", () => {
  it("公開前の下書き分をイベントの枠へ付け替える", async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 });
    const count = await attributeFlyerLogsToEvent(DRAFT_KEY, EVENT_ID);
    expect(count).toBe(2);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { draftKey: DRAFT_KEY, eventId: null },
      data: { eventId: EVENT_ID },
    });
  });
});

describe("flyerQuotaLabel", () => {
  it("新規作成は下書き単位であることを示す", () => {
    expect(
      flyerQuotaLabel({ limit: 3, used: 2, remaining: 1, anonymous: false }),
    ).toBe("この下書きでチラシを作成・変更できるのは、残り 1 回（最大 3 回）");
  });

  it("保存済みイベントはイベント単位であることを示す", () => {
    expect(
      flyerQuotaLabel(
        { limit: 3, used: 1, remaining: 2, anonymous: false },
        { eventScoped: true },
      ),
    ).toBe("このイベントでチラシを作成・変更できるのは、残り 2 回（最大 3 回）");
  });

  it("未ログインは端末通算であることを示す", () => {
    expect(
      flyerQuotaLabel({ limit: 1, used: 1, remaining: 0, anonymous: true }),
    ).toBe("未ログインでチラシを作成・変更できるのは、残り 0 回（最大 1 回）");
  });
});
