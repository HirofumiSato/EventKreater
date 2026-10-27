/**
 * PDF ダウンロードの URL・ファイル名。ブラウザからも読むため、
 * PDF 合成の依存（pdf-lib・qrcode・sharp）はこのファイルへ入れない。
 */
import { flyerFileBase } from "@/modules/flyers/lib/download";

/** 公開告知ページのパス。QR の内容とダウンロードの検証に使う。 */
export function flyerEventPagePath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

/** PDF ダウンロードの URL。イベント ID を検証に使う。 */
export function flyerPdfDownloadHref(id: string, eventId: string): string {
  const query = new URLSearchParams({ eventId });
  return `/api/v1/flyer-assets/${encodeURIComponent(id)}/pdf?${query.toString()}`;
}

/** ダウンロード時のファイル名。`チラシ-忘年会2026.pdf` の形。 */
export function flyerPdfDownloadFilename(
  title: string | null | undefined,
  id: string,
): string {
  return `${flyerFileBase(title, id)}.pdf`;
}
