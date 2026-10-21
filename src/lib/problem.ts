export interface ProblemBody {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  error?: string;
  /** ログイン確認番号で、あと何回まで入力できるか。 */
  remainingAttempts?: number;
  /** ログイン確認番号の試行上限。 */
  attemptLimit?: number;
  /** ロックが解除されるまでの秒数。 */
  retryAfterSeconds?: number;
  /** ロックが解除される時刻（ISO 8601）。 */
  lockedUntil?: string;
  [key: string]: unknown;
}

export async function readProblemBody(response: Response): Promise<ProblemBody> {
  try {
    return (await response.json()) as ProblemBody;
  } catch {
    return { detail: `リクエストに失敗しました (${response.status})` };
  }
}

export function problemMessage(body: ProblemBody, fallback = "リクエストに失敗しました"): string {
  return body.detail || body.error || fallback;
}

export async function readProblem(response: Response): Promise<string> {
  return problemMessage(await readProblemBody(response), `リクエストに失敗しました (${response.status})`);
}

/** 未登録の幹事が、会員登録の要る操作に触れたときのエラーコード。 */
export const REGISTER_REQUIRED = "REGISTER_REQUIRED";

export function isRegisterRequired(body: { error?: string }): boolean {
  return body.error === REGISTER_REQUIRED;
}

/**
 * Cookie は残っているがトークンが検証できない状態。
 * BFF は 401 を返すので、作り直しではなくログインし直しへ誘導する。
 */
export function isSessionExpired(body: { status?: number; error?: string }): boolean {
  return body.status === 401 && body.error !== REGISTER_REQUIRED;
}

/**
 * 未登録の幹事を登録案内ページへ送る。送ったら true。
 * 出欠の管理・リマインド・領収書・共同幹事の招待・24時間を過ぎた編集で返る。
 */
export function sendToRegisterRequired(eventId: string): boolean {
  if (typeof window === "undefined") return false;
  window.location.assign(`/organizer/register-required?eventId=${encodeURIComponent(eventId)}`);
  return true;
}
