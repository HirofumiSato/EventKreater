import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { contentDisposition, flyerDownloadFilename } from "@/modules/flyers/lib/download";
import { assertFlyerAssetId, readFlyerImage } from "@/modules/flyers/lib/flyer";
import { detectImageKind, imageContentType } from "@/modules/flyers/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * 保存済みチラシの画像。`?download=1` を付けると、催し名を使った
 * ファイル名で添付保存になる。形式は保存バイト列の先頭から判定する。
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const id = assertFlyerAssetId(params.id);
    const bytes = await readFlyerImage(id);
    const kind = detectImageKind(bytes) ?? "jpeg";
    const download = req.nextUrl.searchParams.get("download") === "1";
    const headers = new Headers({
      "Content-Type": imageContentType(kind),
      "Cache-Control": download
        ? "private, no-store"
        : "public, max-age=31536000, immutable",
    });
    if (download) {
      const asset = await prisma.flyerAsset.findUnique({
        where: { id },
        select: { title: true },
      });
      headers.set(
        "Content-Disposition",
        contentDisposition("attachment", flyerDownloadFilename(asset?.title, kind, id)),
      );
    }
    return new NextResponse(new Uint8Array(bytes), { headers });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyer-assets/${params.id}/image`);
  }
}
