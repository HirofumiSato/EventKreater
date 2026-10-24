"use client";

import { useEffect, useState, type FormEvent } from "react";
import { problemMessage, readProblemBody, type ProblemBody } from "@/lib/problem";
import { remainingCooldownSeconds } from "@/modules/auth/lib/resend";

interface ChallengeView {
  channel: "SMS" | "EMAIL";
  destinationMask: string;
  canUseSms: boolean;
  canUseEmail: boolean;
  attemptsRemaining?: number;
  attemptLimit?: number;
  lockMinutes?: number;
}

const FALLBACK_ATTEMPT_LIMIT = 10;
const FALLBACK_LOCK_MINUTES = 15;
/** この回数以上間違えたら、残り回数を出す。 */
const WARN_AFTER_FAILURES = 3;

function lockNotice(body: ProblemBody): string {
  const seconds = typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : null;
  const untilMs = typeof body.lockedUntil === "string" ? Date.parse(body.lockedUntil) : Number.NaN;
  const minutes = seconds === null ? null : Math.max(1, Math.ceil(seconds / 60));
  const clock = Number.isNaN(untilMs)
    ? null
    : new Date(untilMs).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (minutes !== null && clock) {
    return `アカウントはロック中です。あと${minutes}分（${clock}ごろ）で自動的に解除されます。`;
  }
  if (minutes !== null) {
    return `アカウントはロック中です。あと${minutes}分で自動的に解除されます。`;
  }
  return problemMessage(body, "アカウントはロック中です。しばらく待ってから再度お試しください。");
}

function attemptWarning(remaining: number | undefined, attemptLimit: number): string | null {
  if (typeof remaining !== "number" || remaining <= 0) return null;
  if (attemptLimit - remaining < WARN_AFTER_FAILURES) return null;
  return `あと${remaining}回でアカウントがロックされます。`;
}

/** 本文に埋め込まれたロック予告。画面では黄色の案内として別に出す。 */
const LOCK_WARNING_PATTERN = /あと\d+回でアカウントがロックされます。/;

function describeProblem(body: ProblemBody, fallback: string): {
  error: string | null;
  attemptNotice: string | null;
  lockedNotice: string | null;
} {
  if (body.error === "ACCOUNT_LOCKED") {
    return { error: null, attemptNotice: null, lockedNotice: lockNotice(body) };
  }
  const attemptNotice = attemptWarning(body.remainingAttempts, body.attemptLimit ?? FALLBACK_ATTEMPT_LIMIT);
  const detail = problemMessage(body, fallback);
  // 同じ予告を赤い案内と黄色い案内で二重に出さない。
  const error = attemptNotice && LOCK_WARNING_PATTERN.test(detail) ? detail.replace(LOCK_WARNING_PATTERN, "").trim() : detail;
  return {
    error,
    attemptNotice,
    lockedNotice: null,
  };
}

export function LoginChallengeForm({
  onConfirmed,
  onRestart,
  screenName = "確認番号",
}: {
  onConfirmed: (result: { phoneVerified: boolean; platformRole?: "MEMBER" | "ADMIN" }) => void;
  onRestart?: () => void;
  screenName?: string;
}) {
  const [view, setView] = useState<ChallengeView | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attemptNotice, setAttemptNotice] = useState<string | null>(null);
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 確認番号の送信（切替・再送）。照合の送信とは別に扱い、主ボタンの文言を混ぜない。 */
  const [sending, setSending] = useState(false);
  /** 直近に送った時刻。二重送信を防ぐクールダウンの起点。 */
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cooldownSeconds = remainingCooldownSeconds(sentAt, now);

  // クールダウンの残りを 1 秒刻みで描き直す。0 になったら止める。
  useEffect(() => {
    if (sentAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (remainingCooldownSeconds(sentAt, next) === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [sentAt]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await fetch("/api/v1/auth/login-challenge");
      if (!active) return;
      if (!res.ok) {
        const state = describeProblem(await readProblemBody(res), "確認番号の入力を続けられませんでした");
        setError(state.error);
        setAttemptNotice(state.attemptNotice);
        setLockedNotice(state.lockedNotice);
        return;
      }
      const body = (await res.json()) as ChallengeView;
      setView(body);
      // この画面に来た時点で 1 通は送れている。すぐの押し直しを防ぐ。
      setSentAt(Date.now());
      setAttemptNotice(attemptWarning(body.attemptsRemaining, body.attemptLimit ?? FALLBACK_ATTEMPT_LIMIT));
    })();
    return () => {
      active = false;
    };
  }, []);

  const deliver = async (channel: "SMS" | "EMAIL", intent: "switch" | "resend" = "switch") => {
    setSending(true);
    setError(null);
    setNotice(null);
    setAttemptNotice(null);
    setLockedNotice(null);
    try {
      const res = await fetch("/api/v1/auth/login-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) {
        const state = describeProblem(await readProblemBody(res), "確認番号を送れませんでした");
        setError(state.error);
        setAttemptNotice(state.attemptNotice);
        setLockedNotice(state.lockedNotice);
        return;
      }
      const body = (await res.json()) as ChallengeView;
      setView(body);
      setCode("");
      setSentAt(Date.now());
      setAttemptNotice(attemptWarning(body.attemptsRemaining, body.attemptLimit ?? FALLBACK_ATTEMPT_LIMIT));
      setNotice(
        intent === "resend"
          ? `確認番号を ${body.destinationMask} へ送り直しました。`
          : channel === "EMAIL"
            ? "確認番号をメールで送りました。"
            : "確認番号をSMSで送りました。",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確認番号を送れませんでした");
    } finally {
      setSending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login-challenge/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const state = describeProblem(await readProblemBody(res), "確認できませんでした");
        setError(state.error);
        setAttemptNotice(state.attemptNotice);
        setLockedNotice(state.lockedNotice);
        setCode("");
        return;
      }
      const body = (await res.json()) as { phoneVerified?: boolean; platformRole?: "MEMBER" | "ADMIN" };
      onConfirmed({ phoneVerified: Boolean(body.phoneVerified), platformRole: body.platformRole });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確認できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  if (!view && !error && !lockedNotice) {
    return <p className="empty">読み込んでいます</p>;
  }

  if (!view) {
    return (
      <div className="stack">
        <div>
          <p className="eyebrow">確認</p>
          <h1 className="page-title">{screenName}</h1>
          <p className="page-lead">確認番号の入力からやり直してください。</p>
        </div>
        <div className="auth-card">
          {lockedNotice ? <p className="alert alert--warning">{lockedNotice}</p> : null}
          {error ? <p className="alert alert--error">{error}</p> : null}
          {onRestart ? (
            <div className="panel__actions">
              <button type="button" className="btn btn--outline btn--block" onClick={onRestart}>
                ログインからやり直す
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const attemptLimit = view.attemptLimit ?? FALLBACK_ATTEMPT_LIMIT;
  const lockMinutes = view.lockMinutes ?? FALLBACK_LOCK_MINUTES;
  const locked = Boolean(lockedNotice);

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">確認</p>
        <h1 className="page-title">{screenName}</h1>
        <p className="page-lead">
          {view.channel === "SMS"
            ? `登録済みの電話 ${view.destinationMask} へSMSで確認番号を送りました。`
            : `登録済みのメール ${view.destinationMask} へ確認番号を送りました。`}
        </p>
      </div>
      {lockedNotice ? <p className="alert alert--warning">{lockedNotice}</p> : null}
      {attemptNotice ? <p className="alert alert--warning">{attemptNotice}</p> : null}
      <div className="auth-card">
        <h2 className="auth-card__title">6桁の確認番号を入れる</h2>
        <p className="auth-card__note">
          {attemptLimit}回間違えると、アカウントが{lockMinutes}分間ロックされます。
        </p>
        <form className="auth-card__body" onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="login-challenge-code">
              6桁の確認番号
            </label>
            <input
              id="login-challenge-code"
              required
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              disabled={locked}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="input code-input"
            />
          </div>
          {notice ? <p className="alert alert--success">{notice}</p> : null}
          {error ? <p className="alert alert--error">{error}</p> : null}
          <div className="panel__actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={submitting || sending || locked}>
              {submitting ? "確認しています" : "確認して入る"}
            </button>
            {onRestart ? (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                disabled={submitting || sending}
                onClick={onRestart}
              >
                ログインからやり直す
              </button>
            ) : null}
          </div>
        </form>
        <div className="panel__actions">
          <button
            type="button"
            className="btn btn--ghost btn--block"
            disabled={submitting || sending || locked || cooldownSeconds > 0}
            onClick={() => void deliver(view.channel, "resend")}
          >
            {sending
              ? "確認番号を送信しています"
              : cooldownSeconds > 0
                ? `確認番号を再送する（あと${cooldownSeconds}秒）`
                : "確認番号を再送する"}
          </button>
          {view.channel === "SMS" && view.canUseEmail ? (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              disabled={submitting || sending || locked}
              onClick={() => void deliver("EMAIL")}
            >
              SMSが届かないのでメールで受け取る
            </button>
          ) : null}
          {view.channel === "EMAIL" && view.canUseSms ? (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              disabled={submitting || sending || locked}
              onClick={() => void deliver("SMS")}
            >
              SMSで受け取る
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
