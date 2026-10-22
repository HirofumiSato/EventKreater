/**
 * 認証まわりの試行回数の定義。上限は 1 か所に集約する。
 *
 * 上限を足すときは `RateLimitRule.label`（画面と detail に出す対象名）が型で必須になるため、
 * 表示文言の無い上限を追加できない。値は環境変数で上書きでき、不正値は既定値へ落とす。
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export interface RateLimitRule {
  /** auth_attempts.bucket の接頭辞。変えるとそれまでの回数を引き継げない。 */
  keyPrefix: string;
  /** 画面と detail に出す対象名。 */
  label: string;
  /** 窓の中で許す回数。 */
  limit: number;
  /** 窓の長さ。 */
  windowMs: number;
}

export interface RateLimitRules {
  loginEmail: RateLimitRule;
  loginIp: RateLimitRule;
  adminLoginEmail: RateLimitRule;
  adminLoginIp: RateLimitRule;
  registerIp: RateLimitRule;
  loginSmsUser: RateLimitRule;
  loginSmsIp: RateLimitRule;
  loginEmailChallengeUser: RateLimitRule;
  loginEmailChallengeIp: RateLimitRule;
  loginConfirmIp: RateLimitRule;
  /** ログイン確認番号の入力ミス。上限に達するとアカウントをロックする。 */
  loginChallengeFailure: RateLimitRule;
  verifyEmail: RateLimitRule;
  verifyIp: RateLimitRule;
  verifyTokenIp: RateLimitRule;
  phoneStartNumber: RateLimitRule;
  phoneStartIp: RateLimitRule;
  phoneChangeNumber: RateLimitRule;
  phoneChangeIp: RateLimitRule;
  phoneConfirmIp: RateLimitRule;
  phoneChangeConfirmIp: RateLimitRule;
}

export interface AuthRateLimits {
  rules: RateLimitRules;
  /** 1 つの確認コードで許す入力ミス。 */
  codeMaxAttempts: number;
  /** ログイン確認番号のロック時間。 */
  lockMs: number;
}

/** 正の整数だけを受け付ける。未設定・空文字・0・負数・小数・数値でない文字列は既定値。 */
export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  const parsed = raw === undefined || raw.trim() === "" ? null : Number(raw);
  if (parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)) {
    if (env.NODE_ENV !== "production") {
      console.warn(`[rate-limits] ${name} の値 "${raw}" は正の整数ではないため ${fallback} を使います。`);
    }
    return fallback;
  }
  return parsed ?? fallback;
}

export function createRateLimits(env: NodeJS.ProcessEnv): AuthRateLimits {
  const attemptLimit = readInt(env, "AUTH_ATTEMPT_LIMIT", 10);
  const attemptIpLimit = readInt(env, "AUTH_ATTEMPT_IP_LIMIT", 40);
  const attemptWindowMs = readInt(env, "AUTH_ATTEMPT_WINDOW_MINUTES", 15) * MINUTE_MS;
  const sendLimit = readInt(env, "AUTH_SEND_LIMIT", 5);
  const sendIpLimit = readInt(env, "AUTH_SEND_IP_LIMIT", 10);
  const registerIpLimit = readInt(env, "AUTH_REGISTER_IP_LIMIT", 5);
  const confirmIpLimit = readInt(env, "AUTH_CONFIRM_IP_LIMIT", 20);
  const codeMaxAttempts = readInt(env, "AUTH_CODE_MAX_ATTEMPTS", 10);
  const lockMs = readInt(env, "AUTH_LOCK_MINUTES", 15) * MINUTE_MS;

  return {
    codeMaxAttempts,
    lockMs,
    rules: {
      loginEmail: {
        keyPrefix: "login:email:",
        label: "このメールアドレスのログイン",
        limit: attemptLimit,
        windowMs: attemptWindowMs,
      },
      loginIp: {
        keyPrefix: "login:ip:",
        label: "この接続からのログイン",
        limit: attemptIpLimit,
        windowMs: attemptWindowMs,
      },
      adminLoginEmail: {
        keyPrefix: "admin-login:email:",
        label: "このメールアドレスの管理者ログイン",
        limit: attemptLimit,
        windowMs: attemptWindowMs,
      },
      adminLoginIp: {
        keyPrefix: "admin-login:ip:",
        label: "この接続からの管理者ログイン",
        limit: attemptIpLimit,
        windowMs: attemptWindowMs,
      },
      registerIp: {
        keyPrefix: "register:ip:",
        label: "この接続からの会員登録",
        limit: registerIpLimit,
        windowMs: HOUR_MS,
      },
      loginSmsUser: {
        keyPrefix: "login-2fa:sms:user:",
        label: "確認番号のSMS送信",
        limit: sendLimit,
        windowMs: HOUR_MS,
      },
      loginSmsIp: {
        keyPrefix: "login-2fa:sms:ip:",
        label: "この接続からの確認番号のSMS送信",
        limit: sendIpLimit,
        windowMs: HOUR_MS,
      },
      loginEmailChallengeUser: {
        keyPrefix: "login-2fa:email:user:",
        label: "確認番号のメール送信",
        limit: sendLimit,
        windowMs: HOUR_MS,
      },
      loginEmailChallengeIp: {
        keyPrefix: "login-2fa:email:ip:",
        label: "この接続からの確認番号のメール送信",
        limit: sendIpLimit,
        windowMs: HOUR_MS,
      },
      loginConfirmIp: {
        keyPrefix: "login-2fa:confirm:ip:",
        label: "確認番号の照合",
        limit: confirmIpLimit,
        windowMs: HOUR_MS,
      },
      loginChallengeFailure: {
        keyPrefix: "login-2fa:fail:user:",
        label: "確認番号の入力",
        limit: codeMaxAttempts,
        windowMs: lockMs,
      },
      verifyEmail: {
        keyPrefix: "verify:email:",
        label: "確認メールの再送",
        limit: sendLimit,
        windowMs: HOUR_MS,
      },
      verifyIp: {
        keyPrefix: "verify:ip:",
        label: "この接続からの確認メールの再送",
        limit: sendIpLimit,
        windowMs: HOUR_MS,
      },
      verifyTokenIp: {
        keyPrefix: "verify-token:ip:",
        label: "確認リンクの照合",
        limit: sendIpLimit,
        windowMs: HOUR_MS,
      },
      phoneStartNumber: {
        keyPrefix: "phone:start:number:",
        label: "電話番号への確認コード送信",
        limit: sendLimit,
        windowMs: HOUR_MS,
      },
      phoneStartIp: {
        keyPrefix: "phone:start:ip:",
        label: "この接続からの確認コード送信",
        limit: sendIpLimit,
        windowMs: HOUR_MS,
      },
      phoneChangeNumber: {
        keyPrefix: "phone:change:number:",
        label: "新しい電話番号への確認コード送信",
        limit: sendLimit,
        windowMs: HOUR_MS,
      },
      phoneChangeIp: {
        keyPrefix: "phone:change:ip:",
        label: "この接続からの確認コード送信",
        limit: sendIpLimit,
        windowMs: HOUR_MS,
      },
      phoneConfirmIp: {
        keyPrefix: "phone:confirm:ip:",
        label: "確認コードの照合",
        limit: confirmIpLimit,
        windowMs: HOUR_MS,
      },
      phoneChangeConfirmIp: {
        keyPrefix: "phone:change:confirm:ip:",
        label: "確認コードの照合",
        limit: confirmIpLimit,
        windowMs: HOUR_MS,
      },
    },
  };
}

export const AUTH_RATE_LIMITS = createRateLimits(process.env);
