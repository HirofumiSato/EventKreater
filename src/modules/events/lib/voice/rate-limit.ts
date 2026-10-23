import { ProblemDetailException } from "@/lib/exceptions";
import { parsePositiveInt } from "@/modules/auth/lib/rate-limits";

/**
 * 音声認識の回数制限。OpenAI の従量課金を守るために、接続元ごとに数える。
 *
 * プロセス内の Map なので、インスタンスを増やすと合計の上限も増える。
 * 音声入力は 1 件あたり十数回呼ぶため、1 人が 1 件作ると上限の半分近くを使う。
 * 既定は 1 時間 40 回。足りない環境では環境変数で上げる。
 */

const DEFAULT_LIMIT = 40;
const DEFAULT_WINDOW_MINUTES = 60;

/** メモリを食い尽くさないための、数える相手の上限。 */
const MAX_TRACKED_IPS = 2000;

const attempts = new Map<string, number[]>();

export interface VoiceRateLimitRule {
  limit: number;
  windowMs: number;
}

export function voiceRateLimitRule(): VoiceRateLimitRule {
  return {
    limit: parsePositiveInt(process.env.VOICE_TRANSCRIBE_LIMIT, DEFAULT_LIMIT),
    windowMs:
      parsePositiveInt(process.env.VOICE_TRANSCRIBE_WINDOW_MINUTES, DEFAULT_WINDOW_MINUTES) *
      60 *
      1000,
  };
}

function prune(map: Map<string, number[]>, now: number, windowMs: number): void {
  for (const [key, times] of map) {
    const recent = times.filter((at) => now - at < windowMs);
    if (recent.length === 0) map.delete(key);
    else map.set(key, recent);
  }
}

/**
 * 1 回ぶん消費する。上限に達していれば 429 を投げる。
 * 消費は認識を呼ぶ前に行う。失敗した呼び出しでも課金されうるため。
 */
export function consumeVoiceRateLimit(clientKey: string): void {
  const rule = voiceRateLimitRule();
  const now = Date.now();
  const key = clientKey || "unknown";

  if (attempts.size >= MAX_TRACKED_IPS) prune(attempts, now, rule.windowMs);

  const recent = (attempts.get(key) ?? []).filter((at) => now - at < rule.windowMs);
  if (recent.length >= rule.limit) {
    const oldest = recent[0] ?? now;
    const retryAt = new Date(oldest + rule.windowMs);
    const retryAfterSeconds = Math.min(
      Math.round(rule.windowMs / 1000),
      Math.max(1, Math.ceil((retryAt.getTime() - now) / 1000)),
    );
    throw new ProblemDetailException({
      status: 429,
      title: "Too Many Requests",
      detail: "音声入力の利用回数が上限に達しました。しばらく待つか、手で入力してください。",
      error: "RATE_LIMITED",
      limitLabel: "音声入力",
      attemptLimit: rule.limit,
      remainingAttempts: 0,
      windowSeconds: Math.round(rule.windowMs / 1000),
      retryAfterSeconds,
      retryAt: retryAt.toISOString(),
    });
  }

  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > MAX_TRACKED_IPS) prune(attempts, now, rule.windowMs);
}
