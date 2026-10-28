/**
 * チラシのアップロード形式と上限。
 *
 * 実体は `src/lib/image-upload.ts` へ移した（プロフィールのアイコンと同じ検査を使うため）。
 * チラシ側の import をそのまま残すための入口で、ここに規則は書かない。
 */

export {
  MAX_IMAGE_BYTES,
  UPLOAD_ACCEPT,
  detectImageKind,
  imageContentType,
  imageExtension,
  type UploadImageKind,
} from "@/lib/image-upload";
