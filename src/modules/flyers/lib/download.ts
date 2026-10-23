/** チラシ画像のダウンロードに使う、DOM と Next に依存しない純ロジック。 */
import { imageExtension, type UploadImageKind } from "@/modules/flyers/lib/upload";

/** 保存したチラシを開く URL。`download=1` で添付ファイルとして返す。 */
export function flyerDownloadHref(id: string): string {
  return `/api/v1/flyer-assets/${encodeURIComponent(id)}/image?download=1`;
}

/** ファイル名に使えない文字。Windows と macOS の両方で困らない範囲に絞る。 */
const INVALID_FILENAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 長すぎる催し名でファイル名が壊れないよう、この文字数で切る。 */
const MAX_TITLE_LENGTH = 60;

/**
 * ダウンロード時のファイル名。`チラシ-忘年会2026.jpg` の形。
 * 催し名が無い・禁止文字だけのときは ID で作る。
 */
export function flyerDownloadFilename(
  title: string | null | undefined,
  kind: UploadImageKind,
  id: string,
): string {
  const cleaned = Array.from((title ?? "").replace(INVALID_FILENAME, " "))
    .slice(0, MAX_TITLE_LENGTH)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned ? `チラシ-${cleaned}` : `flyer-${id}`;
  return `${base}.${imageExtension(kind)}`;
}

/** RFC 5987。`'` `(` `)` `*` は encodeURIComponent が残すため個別に潰す。 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `Content-Disposition`。古いブラウザ向けの ASCII 名と、
 * 日本語をそのまま渡せる `filename*` を併記する。
 */
export function contentDisposition(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
