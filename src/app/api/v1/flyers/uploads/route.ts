import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { UploadFlyerBackgroundSchema } from "@/lib/schemas";
import { uploadBackgroundCandidate } from "@/modules/flyers/lib/flyer";
import { resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";
import { readFlyerQuota } from "@/modules/flyers/lib/quota";
import { resolveFlyerQuotaScope } from "@/modules/flyers/lib/scope";
import {
  MAX_IMAGE_BYTES,
  detectImageKind,
  imageContentType,
} from "@/modules/flyers/lib/upload";
import { consumeUploadAttempt } from "@/modules/flyers/lib/upload-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * ステップ 2。自分の写真を背景候補にする。
 * 候補を作るだけなので、生成回数（quota）は消費しない。
 */
export async function POST(req: NextRequest) {
  // 失敗した応答にも Cookie を付け、同じ端末の試行回数を数え続けられるようにする。
  let owner: Awaited<ReturnType<typeof resolveFlyerOwner>> | null = null;
  try {
    owner = await resolveFlyerOwner(req);

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES + 1024 * 1024) {
      throw new ProblemDetailException({
        status: 413,
        title: "Payload Too Large",
        type: "probs/upload-too-large",
        detail: "画像は8MB以下にしてください。",
      });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "背景にする画像を選んでください。",
      });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new ProblemDetailException({
        status: 413,
        title: "Payload Too Large",
        type: "probs/upload-too-large",
        detail: "画像は8MB以下にしてください。",
      });
    }

    const capacityText = field(form, "capacity").trim();
    const input = UploadFlyerBackgroundSchema.parse({
      draftKey: field(form, "draftKey"),
      title: field(form, "title"),
      eventDate: field(form, "eventDate"),
      eventTime: field(form, "eventTime"),
      price: field(form, "price"),
      location: field(form, "location"),
      rainPolicy: field(form, "rainPolicy"),
      capacity: capacityText ? Number(capacityText) : null,
      templateId: field(form, "templateId"),
      layoutId: field(form, "layoutId") || "classic",
      eventId: field(form, "eventId") || null,
    });

    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = detectImageKind(bytes);
    if (!kind) {
      throw new ProblemDetailException({
        status: 422,
        title: "Validation Error",
        type: "probs/validation-error",
        error: "INVALID_IMAGE",
        detail: "JPEG / PNG / WebP の画像を選んでください。",
      });
    }

    consumeUploadAttempt(owner.ownerTokenHash);
    const scope = await resolveFlyerQuotaScope(req, input.draftKey, input.eventId);
    const candidate = await uploadBackgroundCandidate({
      bytes,
      contentType: imageContentType(kind),
      payload: input,
      ownerTokenHash: owner.ownerTokenHash,
    });
    const quota = await readFlyerQuota(scope, owner);
    const response = NextResponse.json({ candidate, quota }, { status: 201 });
    if (owner.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
    return response;
  } catch (error) {
    const response = toErrorResponse(error, "/api/v1/flyers/uploads");
    if (owner?.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
    return response;
  }
}
