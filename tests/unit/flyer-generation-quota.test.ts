// チラシ生成の回数を、AI の背景を作った時点で消費する（BFF のルート）。
//
// 数える単位と候補の記録は `quota.ts` の実物を使い、DB と flyer サービスだけを差し替える。
// ルートが「作る前に止める」「1 枚 1 回だけ数える」「保存では数えない」を守ることを見る。
//   1. 残り 0 なら AI を呼ばずに 403（未ログインは REGISTER_REQUIRED）
//   2. AI の候補は 1 枚 1 行で記録し、その枚数だけ消費する
//   3. placeholder（AI の代替）は記録するだけで消費しない
//   4. 残りを超えてサービスを呼ばない
//   5. 保存（generate）は消費せず、選んだ候補をチラシへ結ぶだけ

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { NextRequest } from "next/server";

interface PrismaMock {
  flyerGenerationLog: {
    count: Mock;
    createMany: Mock;
    updateMany: Mock;
  };
  flyerAsset: { create: Mock };
  $transaction: Mock;
}

const mocks = vi.hoisted(() => {
  const prisma: PrismaMock = {
    flyerGenerationLog: {
      count: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    flyerAsset: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  // 直列化可能トランザクションの代わりに、同じモックをそのまま渡す。
  prisma.$transaction.mockImplementation(
    async (fn: (tx: PrismaMock) => Promise<unknown>) => fn(prisma),
  );
  return {
    prisma,
    count: prisma.flyerGenerationLog.count,
    createMany: prisma.flyerGenerationLog.createMany,
    updateMany: prisma.flyerGenerationLog.updateMany,
    createAsset: prisma.flyerAsset.create,
    resolveFlyerOwner: vi.fn(),
    resolveFlyerQuotaScope: vi.fn(),
    proposeBackgroundCandidates: vi.fn(),
    generateFlyerImage: vi.fn(),
    saveFlyerImage: vi.fn(),
    removeFlyerImage: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/modules/flyers/lib/ownership", () => ({
  resolveFlyerOwner: mocks.resolveFlyerOwner,
  writeFlyerOwnerCookie: vi.fn(),
}));
vi.mock("@/modules/flyers/lib/scope", () => ({
  resolveFlyerQuotaScope: mocks.resolveFlyerQuotaScope,
}));
vi.mock("@/modules/flyers/lib/flyer", () => ({
  proposeBackgroundCandidates: mocks.proposeBackgroundCandidates,
  generateFlyerImage: mocks.generateFlyerImage,
  saveFlyerImage: mocks.saveFlyerImage,
  removeFlyerImage: mocks.removeFlyerImage,
}));

import { POST as proposeCandidates } from "@/app/api/v1/flyers/candidates/route";
import { POST as generateFlyer } from "@/app/api/v1/flyers/generate/route";

const AI_CANDIDATE_ID = "0f6a2c6e-6f2a-4c1a-9f3e-6e2b0f3a1c11";
const OTHER_AI_CANDIDATE_ID = "1a7b3d7f-7a3b-4d2b-8f4e-7f3c1a2b4d22";
const BACKGROUND_ID = "2b8c4e8a-8b4c-4e3c-9a5f-8a4d2b3c5e33";
const GENERATION_ID = "3c9d5f9b-9c5d-4f4d-ab6a-9b5e3c4d6f44";
const TOKEN_HASH = "a".repeat(64);
const USER_ID = "99999999-8888-4777-8666-555555555555";

const BODY = {
  title: "川辺の焚き火ナイト",
  eventDate: "2026-11-14",
  eventTime: "18:30〜21:00",
  price: "3,000円",
  location: "多摩川河川敷",
  rainPolicy: "RAIN_OR_SHINE",
  capacity: 15,
  templateId: "style_1_bar_stylish",
  layoutId: "classic",
};

const ASSET = {
  id: "4d0e6a0c-0d6e-4a5a-bc7b-0c6f4d5e7a55",
  imageUrl: "/api/v1/flyer-assets/4d0e6a0c-0d6e-4a5a-bc7b-0c6f4d5e7a55/image",
  lqipDataUrl: null,
  aspectRatio: "A4",
  title: "川辺の焚き火ナイト",
  eventDate: new Date("2026-11-14T00:00:00.000Z"),
  eventTime: "18:30〜21:00",
  price: "3,000円",
  location: "多摩川河川敷",
  rainPolicy: "RAIN_OR_SHINE",
  capacity: 15,
};

function candidate(candidateId: string, source: string) {
  return {
    candidateId,
    kind: "background",
    label: source === "ai" ? "AIの背景" : "テーマの下地",
    description: "",
    imageUrl: `/api/v1/flyers/candidates/${candidateId}`,
    templateId: "style_1_bar_stylish",
    layoutId: "classic",
    paletteId: "theme",
    accentColor: "#8B2635",
    overlayAlpha: 0.55,
    titleColor: null,
    source,
    aiRemaining: null,
    recommended: false,
  };
}

function candidatesRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/flyers/candidates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function generateRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/flyers/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveFlyerOwner.mockResolvedValue({
    userId: USER_ID,
    rawToken: "raw-token",
    ownerTokenHash: TOKEN_HASH,
    issueCookie: false,
  });
  mocks.resolveFlyerQuotaScope.mockResolvedValue({ eventId: null });
});

describe("POST /api/v1/flyers/candidates", () => {
  it("残り 0 なら AI を呼ばずに 403 を返す", async () => {
    mocks.count.mockResolvedValue(3);

    const response = await proposeCandidates(candidatesRequest({ ...BODY, count: 1 }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("FLYER_QUOTA_EXCEEDED");
    expect(mocks.proposeBackgroundCandidates).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("未ログインで残り 0 なら、サービスを呼ばずに REGISTER_REQUIRED を返す", async () => {
    mocks.resolveFlyerOwner.mockResolvedValue({
      userId: null,
      rawToken: "raw-token",
      ownerTokenHash: TOKEN_HASH,
      issueCookie: false,
    });
    mocks.count.mockResolvedValue(1);

    const response = await proposeCandidates(candidatesRequest({ ...BODY, count: 1 }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("REGISTER_REQUIRED");
    expect(mocks.proposeBackgroundCandidates).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("AI の候補は 1 枚 1 行で記録し、その枚数だけ消費する", async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    mocks.proposeBackgroundCandidates.mockResolvedValue({
      candidates: [
        candidate(AI_CANDIDATE_ID, "ai"),
        candidate(OTHER_AI_CANDIDATE_ID, "ai"),
      ],
      aiFallback: false,
    });
    mocks.createMany.mockResolvedValue({ count: 2 });

    const response = await proposeCandidates(candidatesRequest({ ...BODY, count: 2 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    // 残り 3 枚のうち 2 枚を作ったので、残りは 1 枚。
    expect(body.quota).toEqual({ limit: 3, used: 2, remaining: 1, anonymous: false });
    expect(body.candidates).toHaveLength(2);
    // 残りを超えないよう、サービスの枚数は残りで丸める。
    expect(mocks.proposeBackgroundCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ title: BODY.title }),
      2,
      TOKEN_HASH,
    );
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ candidateId: AI_CANDIDATE_ID, source: "ai", eventId: null }),
      expect.objectContaining({ candidateId: OTHER_AI_CANDIDATE_ID, source: "ai", eventId: null }),
    ]);
  });

  it("placeholder は記録するだけで消費しない", async () => {
    mocks.count.mockResolvedValue(0);
    mocks.proposeBackgroundCandidates.mockResolvedValue({
      candidates: [candidate(AI_CANDIDATE_ID, "placeholder")],
      aiFallback: true,
    });
    mocks.createMany.mockResolvedValue({ count: 1 });

    const response = await proposeCandidates(candidatesRequest({ ...BODY, count: 1 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    // 記録後の数え直しでも使った枚数は 0 のまま。
    expect(body.quota).toEqual({ limit: 3, used: 0, remaining: 3, anonymous: false });
    expect(mocks.createMany.mock.calls[0][0].data[0]).toMatchObject({
      candidateId: AI_CANDIDATE_ID,
      source: "placeholder",
    });
  });

  it("残りを超えてサービスを呼ばない", async () => {
    // 上限 3 枚のうち 2 枚を使っていて、8 枚を頼まれた場合。
    mocks.count.mockResolvedValue(2);
    mocks.proposeBackgroundCandidates.mockResolvedValue({
      candidates: [candidate(AI_CANDIDATE_ID, "placeholder")],
      aiFallback: true,
    });
    mocks.createMany.mockResolvedValue({ count: 1 });

    await proposeCandidates(candidatesRequest({ ...BODY, count: 8 }));

    expect(mocks.proposeBackgroundCandidates.mock.calls[0][1]).toBe(1);
  });
});

describe("POST /api/v1/flyers/generate", () => {
  beforeEach(() => {
    mocks.generateFlyerImage.mockResolvedValue({
      generationId: GENERATION_ID,
      bytes: Buffer.from("jpeg"),
      status: "generated",
    });
    mocks.saveFlyerImage.mockResolvedValue(undefined);
    mocks.createAsset.mockResolvedValue(ASSET);
  });

  it("保存では回数を消費せず、選んだ背景をチラシへ結ぶ", async () => {
    mocks.count.mockResolvedValue(2);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const response = await generateFlyer(
      generateRequest({
        ...BODY,
        candidateId: AI_CANDIDATE_ID,
        backgroundCandidateId: BACKGROUND_ID,
        paletteId: "theme",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    // 保存では 1 行も足さない。返すのは読んだだけの残り枚数。
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(body.quota).toEqual({ limit: 3, used: 2, remaining: 1, anonymous: false });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        eventId: null,
        candidateId: BACKGROUND_ID,
        flyerAssetId: null,
      },
      data: { flyerAssetId: ASSET.id },
    });
  });

  it("背景の候補を選ばずに保存したときは、生成ログを結ばない", async () => {
    mocks.count.mockResolvedValue(0);

    const response = await generateFlyer(
      generateRequest({
        ...BODY,
        candidateId: AI_CANDIDATE_ID,
        paletteId: "theme",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
