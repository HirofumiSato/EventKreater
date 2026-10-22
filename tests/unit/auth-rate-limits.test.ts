import { describe, expect, it } from "vitest";
import { ProblemDetailException } from "@/lib/exceptions";
import { problemResponse } from "@/lib/http";
import { limitNotice, problemDetail, problemMessage } from "@/lib/problem";
import { createRateLimits, parsePositiveInt } from "@/modules/auth/lib/rate-limits";

/** 警告を出さずに env を渡すための、本番相当の環境。 */
const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("parsePositiveInt", () => {
  it("未設定と空文字は既定値", () => {
    expect(parsePositiveInt(undefined, 10)).toBe(10);
    expect(parsePositiveInt("", 10)).toBe(10);
    expect(parsePositiveInt("   ", 10)).toBe(10);
  });

  it("正の整数を受け付ける", () => {
    expect(parsePositiveInt("7", 10)).toBe(7);
    expect(parsePositiveInt(" 7 ", 10)).toBe(7);
    expect(parsePositiveInt("1000", 10)).toBe(1000);
  });

  it("0・負数・小数・数値でない文字列は既定値へ落とす", () => {
    expect(parsePositiveInt("0", 10)).toBe(10);
    expect(parsePositiveInt("-3", 10)).toBe(10);
    expect(parsePositiveInt("1.5", 10)).toBe(10);
    expect(parsePositiveInt("abc", 10)).toBe(10);
  });
});

describe("createRateLimits", () => {
  it("既定値は 3 回ではなく、照合 10 回・送信 5 回", () => {
    const { rules, codeMaxAttempts, lockMs } = createRateLimits(PROD);
    expect(rules.loginEmail.limit).toBe(10);
    expect(rules.loginIp.limit).toBe(40);
    expect(rules.adminLoginEmail.limit).toBe(10);
    expect(rules.loginSmsUser.limit).toBe(5);
    expect(rules.loginEmailChallengeUser.limit).toBe(5);
    expect(rules.phoneStartNumber.limit).toBe(5);
    expect(rules.phoneChangeNumber.limit).toBe(5);
    expect(rules.verifyEmail.limit).toBe(5);
    expect(rules.registerIp.limit).toBe(5);
    expect(rules.loginConfirmIp.limit).toBe(20);
    expect(codeMaxAttempts).toBe(10);
    expect(lockMs).toBe(15 * 60 * 1000);
  });

  it("窓は照合が 15 分、送信が 1 時間", () => {
    const { rules } = createRateLimits(PROD);
    expect(rules.loginEmail.windowMs).toBe(15 * 60 * 1000);
    expect(rules.loginSmsUser.windowMs).toBe(60 * 60 * 1000);
    expect(rules.verifyEmail.windowMs).toBe(60 * 60 * 1000);
    expect(rules.phoneStartNumber.windowMs).toBe(60 * 60 * 1000);
  });

  it("env で上書きできる", () => {
    const { rules, codeMaxAttempts, lockMs } = createRateLimits({
      ...PROD,
      AUTH_ATTEMPT_LIMIT: "20",
      AUTH_ATTEMPT_IP_LIMIT: "60",
      AUTH_ATTEMPT_WINDOW_MINUTES: "30",
      AUTH_SEND_LIMIT: "8",
      AUTH_SEND_IP_LIMIT: "16",
      AUTH_CODE_MAX_ATTEMPTS: "4",
      AUTH_LOCK_MINUTES: "5",
    });
    expect(rules.loginEmail.limit).toBe(20);
    expect(rules.loginIp.limit).toBe(60);
    expect(rules.loginEmail.windowMs).toBe(30 * 60 * 1000);
    expect(rules.loginSmsUser.limit).toBe(8);
    expect(rules.loginSmsIp.limit).toBe(16);
    expect(codeMaxAttempts).toBe(4);
    expect(lockMs).toBe(5 * 60 * 1000);
  });

  it("不正な env は既定値へ落とす", () => {
    const { rules } = createRateLimits({ ...PROD, AUTH_SEND_LIMIT: "0", AUTH_ATTEMPT_LIMIT: "x" });
    expect(rules.loginSmsUser.limit).toBe(5);
    expect(rules.loginEmail.limit).toBe(10);
  });

  it("すべてのルールに対象名がある", () => {
    const { rules } = createRateLimits(PROD);
    for (const rule of Object.values(rules)) {
      expect(rule.label.trim()).not.toBe("");
      expect(rule.keyPrefix.endsWith(":")).toBe(true);
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowMs).toBeGreaterThan(0);
    }
  });

  it("バケットの接頭辞は改定前と同じ（積んだ回数を引き継ぐ）", () => {
    const { rules } = createRateLimits(PROD);
    expect(rules.loginEmail.keyPrefix).toBe("login:email:");
    expect(rules.loginIp.keyPrefix).toBe("login:ip:");
    expect(rules.adminLoginEmail.keyPrefix).toBe("admin-login:email:");
    expect(rules.registerIp.keyPrefix).toBe("register:ip:");
    expect(rules.loginSmsUser.keyPrefix).toBe("login-2fa:sms:user:");
    expect(rules.loginEmailChallengeUser.keyPrefix).toBe("login-2fa:email:user:");
    expect(rules.loginConfirmIp.keyPrefix).toBe("login-2fa:confirm:ip:");
    expect(rules.loginChallengeFailure.keyPrefix).toBe("login-2fa:fail:user:");
    expect(rules.verifyEmail.keyPrefix).toBe("verify:email:");
    expect(rules.verifyTokenIp.keyPrefix).toBe("verify-token:ip:");
    expect(rules.phoneStartNumber.keyPrefix).toBe("phone:start:number:");
    expect(rules.phoneConfirmIp.keyPrefix).toBe("phone:confirm:ip:");
  });
});

describe("limitNotice", () => {
  it("残りがあれば上限と残り回数を出す", () => {
    expect(
      limitNotice({
        attemptLimit: 10,
        windowSeconds: 900,
        remainingAttempts: 7,
        limitLabel: "このメールアドレスのログイン",
      }),
    ).toBe("このメールアドレスのログインは15分に10回までです。あと7回できます。");
  });

  it("残りが無ければ再試行時刻を出す", () => {
    const text = limitNotice({
      attemptLimit: 5,
      windowSeconds: 3600,
      remainingAttempts: 0,
      limitLabel: "確認番号のSMS送信",
      retryAt: new Date("2026-10-22T08:42:00.000Z").toISOString(),
    });
    expect(text).toContain("確認番号のSMS送信は1時間に5回までです。");
    expect(text).toContain("ごろに再度お試しください。");
    expect(text).not.toContain("あと");
  });

  it("窓が時間で割り切れないときは分で出す", () => {
    expect(
      limitNotice({ attemptLimit: 3, windowSeconds: 5400, remainingAttempts: 1, limitLabel: "照合" }),
    ).toBe("照合は90分に3回までです。あと1回できます。");
  });

  it("上限の情報が無い応答では出さない", () => {
    expect(limitNotice({ detail: "失敗" })).toBeNull();
    expect(limitNotice({ attemptLimit: 10, remainingAttempts: 3 })).toBeNull();
  });

  it("アカウントロックは画面ごとの表示に任せる", () => {
    expect(
      limitNotice({ error: "ACCOUNT_LOCKED", attemptLimit: 10, windowSeconds: 900, remainingAttempts: 0 }),
    ).toBeNull();
  });
});

describe("problemMessage", () => {
  it("上限があれば本文のあとに案内を足す", () => {
    expect(
      problemMessage({
        detail: "メールアドレスまたはパスワードが正しくありません。",
        attemptLimit: 10,
        windowSeconds: 900,
        remainingAttempts: 9,
        limitLabel: "このメールアドレスのログイン",
      }),
    ).toBe(
      "メールアドレスまたはパスワードが正しくありません。 このメールアドレスのログインは15分に10回までです。あと9回できます。",
    );
  });

  it("上限が無ければ本文だけ", () => {
    expect(problemMessage({ detail: "失敗" })).toBe("失敗");
    expect(problemDetail({ detail: "失敗" }, "代替")).toBe("失敗");
  });
});

describe("problemResponse の 429 ヘッダ", () => {
  const error = new ProblemDetailException({
    status: 429,
    title: "Too Many Requests",
    detail: "回数の上限に達しました。",
    error: "RATE_LIMITED",
    limitLabel: "確認番号のSMS送信",
    attemptLimit: 5,
    remainingAttempts: 0,
    windowSeconds: 3600,
    retryAfterSeconds: 120,
    retryAt: new Date("2026-10-22T08:42:00.000Z").toISOString(),
  });

  it("Retry-After と X-RateLimit-* を付ける", () => {
    const response = problemResponse(error);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(
      String(Math.floor(Date.parse("2026-10-22T08:42:00.000Z") / 1000)),
    );
  });

  it("429 以外には付けない", () => {
    const response = problemResponse(
      new ProblemDetailException({ status: 401, title: "Unauthorized", detail: "失敗", retryAfterSeconds: 120 }),
    );
    expect(response.headers.get("Retry-After")).toBeNull();
  });
});
