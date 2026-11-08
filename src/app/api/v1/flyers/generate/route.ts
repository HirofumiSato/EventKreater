import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { generateFlyerImage, removeFlyerImage, saveFlyerImage } from "@/modules/flyers/lib/flyer";
import { toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { SelectFlyerCandidateSchema } from "@/lib/schemas";
import { parseEventDate, serializeFlyer } from "@/lib/serializers";
import { attachFlyerAssetToLog, readFlyerQuota } from "@/modules/flyers/lib/quota";
import { resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";
import { resolveFlyerQuotaScope } from "@/modules/flyers/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ウィザードで選ばれた候補を確定し、チラシとして保存する。
 * 回数は背景を作った時点で消費済みなので、ここでは数えない。
 */
export async function POST(req: NextRequest) {
  try {
    const input = SelectFlyerCandidateSchema.parse(await req.json());
    const owner = await resolveFlyerOwner(req);
    const scope = await resolveFlyerQuotaScope(req, input.eventId);

    const generated = await generateFlyerImage(
      input,
      input.candidateId,
      owner.ownerTokenHash,
    );
    const id = randomUUID();
    await saveFlyerImage(id, generated.bytes);
    try {
      const asset = await prisma.$transaction(async (tx) => {
        const created = await tx.flyerAsset.create({
          data: {
            id,
            userId: owner.userId,
            ownerTokenHash: owner.ownerTokenHash,
            externalFlyerId: generated.generationId,
            imageUrl: `/api/v1/flyer-assets/${id}/image`,
            aspectRatio: "A4",
            title: input.title,
            eventDate: parseEventDate(input.eventDate),
            eventTime: input.eventTime,
            price: input.price,
            location: input.location,
            rainPolicy: input.rainPolicy,
            capacity: input.capacity ?? null,
          },
        });
        // 選んだ背景の候補を、保存したチラシへ同じ Tx で結ぶ。
        // 二重保存や他人の候補はここで 409 になり、行ごとロールバックされる。
        if (input.backgroundCandidateId) {
          await attachFlyerAssetToLog(
            {
              scope,
              owner,
              candidateId: input.backgroundCandidateId,
              flyerAssetId: created.id,
            },
            tx,
          );
        }
        return created;
      });

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
      // DB はロールバック済み。保存できなかった画像ファイルも残さない。
      await removeFlyerImage(id);
      throw error;
    }
  } catch (error) {
    return toErrorResponse(error, "/api/v1/flyers/generate");
  }
}
