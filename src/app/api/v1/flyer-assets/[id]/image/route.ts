import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { contentDisposition, flyerDownloadFilename } from "@/modules/flyers/lib/download";
import {
  assertFlyerAssetId,
  parseFlyerImageWidth,
  readFlyerImage,
  readFlyerImageAtWidth,
} from "@/modules/flyers/lib/flyer";
import { detectImageKind, imageContentType } from "@/modules/flyers/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * 保存済みチラシの画像。`?download=1` を付けると、イベント名を使った
 * ファイル名で添付保存になる。形式は保存バイト列の先頭から判定する。
 *
 * `?w=` には縮小して配る幅を入れる（`FLYER_IMAGE_WIDTHS` の 4 段だけ）。
 * 一覧の札は 240 を要求する。一覧に無い値は無視して原寸を返す（勝手な幅で
 * 変換させない）。添付保存は保存したバイト列をそのまま返すので、縮小の対象にしない。
 * 拡大もしない。
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const id = assertFlyerAssetId(params.id);
    const search = req.nextUrl.searchParams;
    const download = search.get("download") === "1";
    const width = download ? null : parseFlyerImageWidth(search.get("w"));
    const bytes = width
      ? await readFlyerImageAtWidth(id, width)
      : await readFlyerImage(id);
    const kind = detectImageKind(bytes) ?? "jpeg";
    const headers = new Headers({
      "Content-Type": imageContentType(kind),
      // 縮小版も URL（`?w=`）ごとに 1 つなので、同じく immutable でよい。
      "Cache-Control": download ? "private, no-store" : "public, max-age=31536000, immutable",
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
