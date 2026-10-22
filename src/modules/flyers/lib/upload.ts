/** ブラウザとサーバーで共有する、背景アップロードの形式と上限。 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** アップロードできる画像形式。SVG・GIF・アニメーションは対象外。 */
export type UploadImageKind = "jpeg" | "png" | "webp";

export const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";

const IMAGE_MIME: Record<UploadImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** 先頭バイトだけで形式を見分ける。完全な検証は flyer サービスが行う。 */
export function detectImageKind(bytes: Uint8Array): UploadImageKind | null {
  const startsWith = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length &&
    signature.every((value, index) => bytes[offset + index] === value);

  if (startsWith([0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (
    startsWith([0x52, 0x49, 0x46, 0x46]) &&
    startsWith([0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  return null;
}

export function imageContentType(kind: UploadImageKind): string {
  return IMAGE_MIME[kind];
}
