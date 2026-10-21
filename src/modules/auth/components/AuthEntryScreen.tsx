"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { readProblem } from "@/lib/problem";
import { resolveInitialAuthMode, type AuthMode } from "@/modules/auth/lib/auth-mode";
import { LoginChallengeForm } from "@/modules/auth/components/LoginChallengeForm";
import { safeNextPath } from "@/modules/auth/lib/google-auth";

export type AuthAudience = "organizer" | "participant";

const GOOGLE_ERRORS: Record<string, string> = {
  google_config: "GoogleログインのクライアントIDが設定されていません。",
  google_denied: "Googleログインがキャンセルされました。",
  google_state: "ログインの確認に失敗しました。もう一度試してください。",
  google_token: "Googleログインに失敗しました。",
  google_email: "確認済みのメールアドレスがあるGoogleアカウントが必要です。",
  google_conflict: "このメールアドレスは別のGoogleアカウントに紐づいています。",
};

async function hydrateSession(): Promise<void> {
  await fetch("/api/v1/user/hydrate", { method: "POST" });
}

const COPY: Record<
  AuthAudience,
  {
    title: { register: string; login: string };
    lead: string;
    submit: { register: string; login: string };
    switchToOther: { href: string; label: string };
    otherLabel: string;
  }
> = {
  organizer: {
    title: { register: "主催者の会員登録", login: "主催者ログイン" },
    lead:
      "イベントを作る幹事の入口です。新規登録は、確認メールのリンクを開いたあと電話番号を確認します。同じ電話番号の会員が既にあるときは、新しいアカウントは作りません。ログインはパスワードのあと、登録済みの電話へSMSで確認番号を送ります。SMSが届かないときはメールでも受け取れます。",
    submit: { register: "登録してはじめる", login: "ログイン" },
    switchToOther: { href: "/participant/login", label: "参加者としてログイン" },
    otherLabel: "参加したイベントの履歴を見たいだけなら",
  },
  participant: {
    title: { register: "参加者の会員登録", login: "参加者ログイン" },
    lead:
      "出欠の履歴を残すための参加者入口です。参加するだけならログインは要りません。登録すると、どの端末からでも自分の出欠と領収書を確認できます。ログインはパスワードのあと、登録済みの電話へSMSで確認番号を送ります。SMSが届かないときはメールでも受け取れます。",
    submit: { register: "登録して履歴を残す", login: "ログイン" },
    switchToOther: { href: "/auth/register", label: "主催者としてログイン" },
    otherLabel: "イベントを作る幹事なら",
  },
};

function AuthEntry({ audience }: { audience: AuthAudience }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = COPY[audience];
  const basePath = audience === "participant" ? "/participant/login" : "/auth/register";
  const defaultLanding = audience === "participant" ? "/participant" : "/mypage";
  const nextPath = safeNextPath(searchParams.get("next"), defaultLanding);
  const hasExplicitNext = searchParams.has("next");
  // 明示された戻り先だけを引き継ぐ。既定値を next として足すと、指定の有無を区別できなくなる。
  const nextQuery = hasExplicitNext ? `&next=${encodeURIComponent(nextPath)}` : "";
  const phoneStep = searchParams.get("step") === "phone";
  const loginCodeStep = searchParams.get("step") === "login-code";
  const googleError = GOOGLE_ERRORS[searchParams.get("error") ?? ""] ?? null;
  const [mode, setMode] = useState<AuthMode>(() => resolveInitialAuthMode(searchParams.get("mode"), hasExplicitNext));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(googleError);
  const [notice, setNotice] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [adminConsoleRequired, setAdminConsoleRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const finish = useCallback(
    async (phoneVerified: boolean, platformRole?: "MEMBER" | "ADMIN") => {
      await hydrateSession();
      if (!phoneVerified) {
        router.push(`${basePath}?step=phone${nextQuery}`);
        router.refresh();
        return;
      }
      // 管理者を管理コンソールへ送るのは、主催者入口で戻り先を指定されていないときだけ。
      const landing =
        audience === "organizer" && !hasExplicitNext && platformRole === "ADMIN" ? "/console" : nextPath;
      router.push(landing);
      router.refresh();
    },
    [audience, basePath, hasExplicitNext, nextPath, nextQuery, router],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setUnverified(false);
    setAdminConsoleRequired(false);
    try {
      const res = await fetch("/api/v1/auth/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register"
            ? { action: "register", name, email, password, audience }
            : { action: "login", email, password, audience },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
        verificationRequired?: boolean;
        challengeRequired?: boolean;
        phoneVerified?: boolean;
      };
      if (!res.ok) {
        if (body.error === "EMAIL_UNVERIFIED") setUnverified(true);
        if (body.error === "ADMIN_CONSOLE_REQUIRED") setAdminConsoleRequired(true);
        throw new Error(body.detail || "認証に失敗しました");
      }
      if (body.verificationRequired) {
        setNotice(body.detail || "確認メールを送信しました。メールのリンクを開いてください。");
        setMode("login");
        setPassword("");
        return;
      }
      if (body.challengeRequired) {
        router.push(`${basePath}?step=login-code${nextQuery}`);
        return;
      }
      await finish(Boolean(body.phoneVerified));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "認証に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { detail?: string };
      setNotice(body.detail || "確認メールを送信しました。");
      setUnverified(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確認メールを再送できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  const completePhone = useCallback(() => {
    void finish(true);
  }, [finish]);

  if (loginCodeStep) {
    return (
      <div className="page--form stack">
        <LoginChallengeForm
          screenName={copy.title.login}
          onConfirmed={({ phoneVerified, platformRole }) => void finish(phoneVerified, platformRole)}
          onRestart={() => router.push(`${basePath}${hasExplicitNext ? `?next=${encodeURIComponent(nextPath)}` : ""}`)}
        />
      </div>
    );
  }

  if (phoneStep) {
    return <PhoneScreen audience={audience} basePath={basePath} nextPath={nextPath} onFinished={completePhone} />;
  }

  return (
    <div className="page--form stack">
      <div>
        <h1 className="page-title">{mode === "register" ? copy.title.register : copy.title.login}</h1>
        <p className="page-lead">{copy.lead}</p>
      </div>
      <div className="segment">
        <label className="segment__item">
          <input type="radio" name="auth-mode" checked={mode === "register"} onChange={() => setMode("register")} />
          新規登録
        </label>
        <label className="segment__item">
          <input type="radio" name="auth-mode" checked={mode === "login"} onChange={() => setMode("login")} />
          ログイン
        </label>
      </div>
      <a
        href={`/api/v1/auth/google?audience=${audience}${hasExplicitNext ? `&next=${encodeURIComponent(nextPath)}` : ""}`}
        className="btn btn--outline btn--block"
      >
        Googleで続ける
      </a>
      <form onSubmit={submit} className="form">
        {mode === "register" && (
          <div className="field">
            <label className="label" htmlFor="register-name">
              名前
            </label>
            <input
              id="register-name"
              required
              maxLength={50}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="input"
            />
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="register-email">
            メールアドレス
          </label>
          <input
            id="register-email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="register-password">
            パスワード
          </label>
          <input
            id="register-password"
            required
            type="password"
            minLength={mode === "register" ? 8 : 1}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input"
          />
          {mode === "register" && <p className="help">8文字以上。漏えいが確認されているパスワードは使えません。</p>}
        </div>
        {notice && <p className="alert alert--success">{notice}</p>}
        {error && <p className="alert alert--error">{error}</p>}
        {adminConsoleRequired && (
          <a className="btn btn--outline btn--block" href="/console/login">
            管理者ログインへ
          </a>
        )}
        {unverified && (
          <button type="button" className="btn btn--outline btn--block" disabled={submitting || !email} onClick={() => void resend()}>
            確認メールを再送する
          </button>
        )}
        <button type="submit" disabled={submitting} className="btn btn--primary btn--block">
          {submitting ? "処理中..." : mode === "register" ? copy.submit.register : copy.submit.login}
        </button>
      </form>
      <p className="help">
        {copy.otherLabel}は <Link href={copy.switchToOther.href} className="text-link">{copy.switchToOther.label}</Link>
      </p>
    </div>
  );
}

function PhoneScreen({
  audience,
  basePath,
  nextPath,
  onFinished,
}: {
  audience: AuthAudience;
  basePath: string;
  nextPath: string;
  onFinished: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/v1/user/profile");
      if (!res.ok || cancelled) return;
      const body = (await res.json()) as { user?: { phoneVerified?: boolean } };
      if (body.user?.phoneVerified) onFinished();
    })();
    return () => {
      cancelled = true;
    };
  }, [onFinished]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/auth/phone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = (await res.json().catch(() => ({}))) as { alreadyVerified?: boolean; detail?: string };
      if (!res.ok) throw new Error(body.detail || "確認コードを送れませんでした");
      if (body.alreadyVerified) {
        onFinished();
        return;
      }
      setSent(true);
      setNotice(body.detail || "確認コードを送信しました。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確認コードを送れませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/phone/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { attachedExisting?: boolean; reactivated?: boolean };
      if (body.reactivated) {
        setNotice("以前のアカウントを引き継ぎました。利用枠は前回の続きからになります。");
      } else if (body.attachedExisting) {
        setNotice("同じ電話番号の会員へ結びつけました。");
      }
      onFinished();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "電話番号の確認に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page--form stack">
      <div>
        <h1 className="page-title">電話番号の確認</h1>
        <p className="page-lead">
          {audience === "participant"
            ? "履歴を残す会員は、確認済みの電話番号が必要です。メールアドレスや Google アカウントが違っても、同じ番号なら同じ会員になります。"
            : "無料枠は、確認済みの電話番号 1 件につき 2 回です。メールアドレスや Google アカウントが違っても、同じ番号なら同じ会員になります。"}{" "}
          確認後の移動先は {nextPath} です。
        </p>
      </div>
      <form onSubmit={sent ? confirm : start} className="form">
        <div className="field">
          <label className="label" htmlFor="register-phone">
            電話番号
          </label>
          <input
            id="register-phone"
            required
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="input"
            placeholder="09012345678"
          />
          <p className="help">日本の携帯電話は 0 から入力できます。国番号付き（+81）も受け付けます。</p>
        </div>
        {sent && (
          <div className="field">
            <label className="label" htmlFor="register-phone-code">
              確認コード（6桁）
            </label>
            <input
              id="register-phone-code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="input"
            />
          </div>
        )}
        {notice && <p className="alert alert--success">{notice}</p>}
        {error && <p className="alert alert--error">{error}</p>}
        <button type="submit" disabled={submitting} className="btn btn--primary btn--block">
          {submitting ? "処理中..." : sent ? "確認して続ける" : "確認コードを送る"}
        </button>
      </form>
      <p className="help">
        <Link href={basePath} className="text-link">
          ログイン画面へ戻る
        </Link>
      </p>
    </div>
  );
}

export function AuthEntryScreen({ audience }: { audience: AuthAudience }) {
  return (
    <Suspense
      fallback={
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          ログイン画面を準備しています
        </p>
      }
    >
      <AuthEntry audience={audience} />
    </Suspense>
  );
}
