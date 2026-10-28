/**
 * 画像アップロードの試行制限。
 *
 * 実体は `src/lib/upload-limit.ts` へ移した（プロフィールのアイコンと同じ制限を使うため）。
 * チラシ側の import と定数名をそのまま残すための入口。
 */

import { UPLOAD_LIMIT, UPLOAD_WINDOW_MS } from "@/lib/upload-limit";

export { consumeUploadAttempt, resetUploadAttempts } from "@/lib/upload-limit";

/** 同じ端末（ownerTokenHash）が 10 分間にアップロードできる回数。 */
export const FLYER_UPLOAD_LIMIT = UPLOAD_LIMIT;
export const FLYER_UPLOAD_WINDOW_MS = UPLOAD_WINDOW_MS;
