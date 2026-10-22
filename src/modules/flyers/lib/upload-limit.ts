import { ProblemDetailException } from "@/lib/exceptions";

/** 同じ端末（ownerTokenHash）が 10 分間にアップロードできる回数。 */
export const FLYER_UPLOAD_LIMIT = 5;
export const FLYER_UPLOAD_WINDOW_MS = 10 * 60 * 1000;

/**
 * プロセス内の試行履歴。単一インスタンス前提の簡易リミッターで、
 * DB は使わない。再起動すると履歴は消える。
 */
const attempts = new Map<string, number[]>();

export function consumeUploadAttempt(key: string, now = Date.now()): void {
  const since = now - FLYER_UPLOAD_WINDOW_MS;
  const recent = (attempts.get(key) ?? []).filter((at) => at > since);
  if (recent.length >= FLYER_UPLOAD_LIMIT) {
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
