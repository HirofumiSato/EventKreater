export interface ProblemBody {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  error?: string;
  /** 上限の対象名（「確認番号のSMS送信」など）。 */
  limitLabel?: string;
  /** ログイン確認番号で、あと何回まで入力できるか。 */
  remainingAttempts?: number;
  /** 試行上限。 */
  attemptLimit?: number;
  /** 上限を数える窓の長さ（秒）。 */
  windowSeconds?: number;
  /** ロック・上限が解除されるまでの秒数。 */
  retryAfterSeconds?: number;
  /** ロック・上限が解除される時刻（ISO 8601）。 */
  lockedUntil?: string;
  /** 次に 1 回ぶん空く時刻（ISO 8601）。 */
  retryAt?: string;
  [key: string]: unknown;
}

export async function readProblemBody(response: Response): Promise<ProblemBody> {
  try {
    return (await response.json()) as ProblemBody;
  } catch {
    return { detail: `リクエストに失敗しました (${response.status})` };
  }
}

function windowText(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}時間`;
  return `${Math.round(seconds / 60)}分`;
}

function clockText(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/**
 * 上限の案内。回数に上限のある操作では、失敗のたびに必ず出す。
 * アカウントロック（ACCOUNT_LOCKED）は画面ごとの専用表示があるため対象外。
 */
export function limitNotice(body: ProblemBody): string | null {
  if (body.error === "ACCOUNT_LOCKED") return null;
  if (typeof body.attemptLimit !== "number" || typeof body.windowSeconds !== "number") return null;
  const label = body.limitLabel ?? "この操作";
  const window = windowText(body.windowSeconds);
  const remaining = body.remainingAttempts;
  if (typeof remaining === "number" && remaining > 0) {
    return `${label}は${window}に${body.attemptLimit}回までです。あと${remaining}回できます。`;
  }
  const clock = body.retryAt ? clockText(body.retryAt) : null;
  return clock
    ? `${label}は${window}に${body.attemptLimit}回までです。${clock}ごろに再度お試しください。`
    : `${label}は${window}に${body.attemptLimit}回までです。しばらく待ってから再度お試しください。`;
}

/** 本文の detail だけを返す。上限を別に描きたい画面が使う。 */
export function problemDetail(body: ProblemBody, fallback = "リクエストに失敗しました"): string {
  return body.detail || body.error || fallback;
}

/** 失敗の本文に、上限の案内があれば添える。 */
export function problemMessage(body: ProblemBody, fallback = "リクエストに失敗しました"): string {
  const base = problemDetail(body, fallback);
  const notice = limitNotice(body);
  return notice ? `${base} ${notice}` : base;
}

export async function readProblem(response: Response): Promise<string> {
  return problemMessage(await readProblemBody(response), `リクエストに失敗しました (${response.status})`);
}

/**
 * 画面側で分岐したい失敗（402 の課金導線など）。
 * 文言だけを投げると状態コードを見失うため、ステータスと本文を添えて運ぶ。
 */
export class RequestProblemError extends Error {
  readonly status: number;
  readonly body: ProblemBody;

  constructor(status: number, body: ProblemBody, fallback?: string) {
    super(problemMessage(body, fallback ?? `リクエストに失敗しました (${status})`));
    this.name = "RequestProblemError";
    this.status = status;
    this.body = body;
  }

  static async fromResponse(response: Response, fallback?: string): Promise<RequestProblemError> {
    return new RequestProblemError(response.status, await readProblemBody(response), fallback);
  }
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
