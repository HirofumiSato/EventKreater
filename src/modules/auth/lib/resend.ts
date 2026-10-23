/**
 * 確認コードの送り直しを押せるようになるまでの残り秒数。
 *
 * 送信の上限はサーバ（`AUTH_RATE_LIMITS`）が持つ。ここは二重送信を防ぐ
 * 画面側のクールダウンだけで、上限とは別の概念である。
 */
export const RESEND_COOLDOWN_MS = 60_000;

export function remainingCooldownSeconds(
  sentAt: number | null,
  now: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): number {
  if (sentAt === null || !Number.isFinite(sentAt) || !Number.isFinite(now)) return 0;
  const total = Math.max(1, Math.ceil(cooldownMs / 1000));
  const elapsed = now - sentAt;
  if (elapsed >= cooldownMs) return 0;
  // 端末の時計が戻っても、クールダウンの長さは超えない。
  return Math.min(total, Math.max(0, Math.ceil((cooldownMs - elapsed) / 1000)));
}
