import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { generateFlyerImage, removeFlyerImage, saveFlyerImage } from "@/modules/flyers/lib/flyer";
import { toErrorResponse } from "@/lib/http";
import { ProblemDetailException } from "@/lib/exceptions";
import { prisma } from "@/lib/prisma";
import { SelectFlyerCandidateSchema } from "@/lib/schemas";
import { parseEventDate, serializeFlyer } from "@/lib/serializers";
import {
  assertFlyerQuota,
  readFlyerQuota,
  recordFlyerGeneration,
  type FlyerOwner,
  type FlyerQuotaScope,
} from "@/modules/flyers/lib/quota";
import { resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";
import { resolveFlyerQuotaScope } from "@/modules/flyers/lib/scope";
import type { SelectFlyerCandidateInput } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 直列化可能トランザクションの競合。共同主催者の同時保存で 4 回目を通さないために引き直す。 */
function isWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

async function saveWithQuota(
  id: string,
  input: SelectFlyerCandidateInput,
  scope: FlyerQuotaScope,
  owner: FlyerOwner,
  generationId: string,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // 生成中に共同主催者が保存していても、ここで数え直してから書く。
          await assertFlyerQuota(scope, owner, tx);
          const asset = await tx.flyerAsset.create({
            data: {
              id,
              userId: owner.userId,
              ownerTokenHash: owner.ownerTokenHash,
              externalFlyerId: generationId,
              imageUrl: `/api/v1/flyer-assets/${id}/image`,
              aspectRatio: "9:16",
              title: input.title,
              eventDate: parseEventDate(input.eventDate),
              eventTime: input.eventTime,
              price: input.price,
              location: input.location,
              rainPolicy: input.rainPolicy,
              capacity: input.capacity ?? null,
            },
          });
          await recordFlyerGeneration(
            {
              scope,
              owner,
              templateId: input.templateId,
              layoutId: input.layoutId,
              paletteId: input.paletteId,
              flyerAssetId: asset.id,
            },
            tx,
          );
          return asset;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isWriteConflict(error)) {
        if (attempt < 2) continue;
        throw new ProblemDetailException({
          status: 409,
          title: "Conflict",
          detail:
            "他の共同主催者と同時に保存されました。回数を確認して、もう一度お試しください。",
        });
      }
      throw error;
    }
  }
}

/**
 * ウィザードで選ばれた候補を確定し、チラシとして保存する。
 * クォータは「確定した回数」だけ数える。候補の作り直しでは減らない。
 */
export async function POST(req: NextRequest) {
  try {
    const input = SelectFlyerCandidateSchema.parse(await req.json());
    const owner = await resolveFlyerOwner(req);
    const scope = await resolveFlyerQuotaScope(req, input.draftKey, input.eventId);
    await assertFlyerQuota(scope, owner);

    const generated = await generateFlyerImage(
      input,
      input.candidateId,
      owner.ownerTokenHash,
    );
    const id = randomUUID();
    await saveFlyerImage(id, generated.bytes);
    try {
      const asset = await saveWithQuota(
        id,
        input,
        scope,
        owner,
        generated.generationId,
      );
      const quota = await readFlyerQuota(scope, owner);
      const response = NextResponse.json(
        {
          flyerAsset: serializeFlyer(asset),
          generationStatus: generated.status,
          quota,
        },
        { status: 201 },
      );
      if (owner.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
      return response;
    } catch (error) {
      await removeFlyerImage(id);
      throw error;
    }
  } catch (error) {
    return toErrorResponse(error, "/api/v1/flyers/generate");
  }
}
