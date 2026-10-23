import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { serializeFlyer } from "@/lib/serializers";
import {
  MAX_IMAGE_BYTES,
  removeFlyerImage,
  saveFlyerImage,
} from "@/modules/flyers/lib/flyer";
import { flyerOwnerFilter, resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";
import { detectImageKind } from "@/modules/flyers/lib/upload";
import { consumeUploadAttempt } from "@/modules/flyers/lib/upload-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const where = await flyerOwnerFilter(req);
    if (!where) {
      return NextResponse.json({ flyers: [] });
    }
    const flyers = await prisma.flyerAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return NextResponse.json({
      flyers: flyers.map((flyer) => serializeFlyer(flyer)),
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/flyer-assets");
  }
}

/** 催し名は DB の varchar(100) に合わせる。絵文字を割らないようコードポイントで切る。 */
function flyerTitle(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return Array.from(value.trim()).slice(0, 100).join("");
}

/**
 * 手元のチラシ画像をそのままアセットにする。生成ではないので quota は消費しない。
 * 原本を再エンコードせず、形式と拡張子だけ保って保存する。
 */
export async function POST(req: NextRequest) {
  let owner: Awaited<ReturnType<typeof resolveFlyerOwner>> | null = null;
  let savedId: string | null = null;
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

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "画像を送信できませんでした。選び直してください。",
      });
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "チラシにする画像を選んでください。",
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

    const id = randomUUID();
    await saveFlyerImage(id, bytes, kind);
    savedId = id;
    const asset = await prisma.flyerAsset.create({
      data: {
        id,
        userId: owner.userId,
        ownerTokenHash: owner.ownerTokenHash,
        externalFlyerId: null,
        imageUrl: `/api/v1/flyer-assets/${id}/image`,
        // 原本の比率のまま掲載するため、固定の比は持たせない。
        aspectRatio: "auto",
        title: flyerTitle(form.get("title")) || null,
      },
    });
    savedId = null;

    const response = NextResponse.json(
      { flyerAsset: serializeFlyer(asset) },
      { status: 201 },
    );
    if (owner.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
    return response;
  } catch (error) {
    if (savedId) await removeFlyerImage(savedId);
    const response = toErrorResponse(error, "/api/v1/flyer-assets");
    if (owner?.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
    return response;
  }
}
