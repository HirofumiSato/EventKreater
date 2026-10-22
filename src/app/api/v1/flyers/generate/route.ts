import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { generateFlyerImage, removeFlyerImage, saveFlyerImage } from "@/modules/flyers/lib/flyer";
import { toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { SelectFlyerCandidateSchema } from "@/lib/schemas";
import { parseEventDate, serializeFlyer } from "@/lib/serializers";
import { assertFlyerQuota, readFlyerQuota, recordFlyerGeneration } from "@/modules/flyers/lib/quota";
import { resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ウィザードで選ばれた候補を確定し、チラシとして保存する。
 * クォータは「確定した回数」だけ数える。候補の作り直しでは減らない。
 */
export async function POST(req: NextRequest) {
  try {
    const input = SelectFlyerCandidateSchema.parse(await req.json());
    const owner = await resolveFlyerOwner(req);
    await assertFlyerQuota(input.draftKey, owner);

    const generated = await generateFlyerImage(
      input,
      input.candidateId,
      owner.ownerTokenHash,
    );
    const id = randomUUID();
    await saveFlyerImage(id, generated.bytes);
    try {
      const asset = await prisma.flyerAsset.create({
        data: {
          id,
          userId: owner.userId,
          ownerTokenHash: owner.ownerTokenHash,
          externalFlyerId: generated.generationId,
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
      await recordFlyerGeneration({
        draftKey: input.draftKey,
        owner,
        templateId: input.templateId,
        layoutId: input.layoutId,
        paletteId: input.paletteId,
        flyerAssetId: asset.id,
      });
      const quota = await readFlyerQuota(input.draftKey, owner);
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
