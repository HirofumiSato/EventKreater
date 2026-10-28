import { ProblemDetailException } from "@/lib/exceptions";

/** 同じキー（端末・会員）が 10 分間にアップロードできる回数。 */
export const UPLOAD_LIMIT = 5;
export const UPLOAD_WINDOW_MS = 10 * 60 * 1000;

/**
 * プロセス内の試行履歴。単一インスタンス前提の簡易リミッターで、
 * DB は使わない。再起動すると履歴は消える。
 *
 * キーは呼び出し側が決める（チラシは端末のハッシュ、アイコンは会員 ID）。
 * チラシとアイコンで同じ窓と上限を共有する。
 */
const attempts = new Map<string, number[]>();

export function consumeUploadAttempt(key: string, now = Date.now()): void {
  const since = now - UPLOAD_WINDOW_MS;
  const recent = (attempts.get(key) ?? []).filter((at) => at > since);
  if (recent.length >= UPLOAD_LIMIT) {
    attempts.set(key, recent);
    throw new ProblemDetailException({
      status: 429,
      title: "Too Many Requests",
      detail: "画像のアップロードが多すぎます。しばらく待ってから再度お試しください。",
    });
  }
  recent.push(now);
  attempts.set(key, recent);

  // 使われないキーが増え続けないよう、古い履歴だけ落とす。
  if (attempts.size > 1000) {
    for (const [candidate, history] of attempts) {
      if (history.every((at) => at <= since)) attempts.delete(candidate);
    }
  }
}

/** テスト用。プロセスの履歴を空にする。 */
export function resetUploadAttempts(): void {
  attempts.clear();
}
