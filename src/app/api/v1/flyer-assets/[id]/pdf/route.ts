import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { appBaseUrl, toErrorResponse } from "@/lib/http";
import { contentDisposition } from "@/modules/flyers/lib/download";
import { assertFlyerAssetId, readFlyerImage } from "@/modules/flyers/lib/flyer";
import { buildFlyerPdf } from "@/modules/flyers/lib/pdf";
import {
  flyerEventPagePath,
  flyerPdfDownloadFilename,
} from "@/modules/flyers/lib/pdf-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): ProblemDetailException {
  return new ProblemDetailException({
    status: 404,
    title: "Not Found",
    detail: "公開済みのチラシが見つかりません。",
  });
}

/**
 * 保存済みチラシの A4 PDF。告知ページの URL を QR にして右下へ重ねる。
 *
 * 焼き込む URL が確定するのは公開後だけなので、`eventId` が公開済みで
 * そのチラシを掲載しているイベントを指すときだけ返す。
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const id = assertFlyerAssetId(params.id);
    const eventId = req.nextUrl.searchParams.get("eventId")?.trim() ?? "";
    if (!UUID.test(eventId)) throw notFound();

    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        flyerAssetId: id,
        status: "PUBLISHED",
        isDeleted: false,
      },
      select: { id: true, title: true },
    });
    if (!event) throw notFound();

    const image = await readFlyerImage(id);
    const pdf = await buildFlyerPdf({
      image,
      qrUrl: `${appBaseUrl()}${flyerEventPagePath(event.id)}`,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(
          "attachment",
          flyerPdfDownloadFilename(event.title, id),
        ),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyer-assets/${params.id}/pdf`);
  }
}
