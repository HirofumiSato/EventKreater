"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { problemMessage, readProblem, readProblemBody, type ProblemBody } from "@/lib/problem";
import { resolveInitialAuthMode, type AuthMode } from "@/modules/auth/lib/auth-mode";
import {
  isSwitchingAccount,
  phoneStepHref,
  resolveAuthLanding,
  resolveSessionDestination,
} from "@/modules/auth/lib/auth-landing";
import { LoginChallengeForm } from "@/modules/auth/components/LoginChallengeForm";
import { useExistingSession } from "@/modules/auth/hooks/useExistingSession";
import { safeNextPath } from "@/modules/auth/lib/google-auth";
import { savePasswordCredential } from "@/modules/auth/lib/password-credential";
import { REFERRAL_COOKIE, REFERRAL_MAX_AGE } from "@/modules/auth/lib/referral-cookie";
import { REFERRAL_TICKET_GRANT } from "@/modules/billing/lib/tickets";
import { Alert, Field, Loading, PageHeader } from "@/components/ui";

export type AuthAudience = "organizer" | "participant";

/**
 * Google ログインの入口はいったん画面に出さない。
 * 入口を出さないだけで、`/api/v1/auth/google` とコールバック、`GOOGLE_ERRORS` の表示は残す。
 * 戻すときはこの値を true にする。
 */
const SHOW_GOOGLE_ENTRY = false;

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
    /** 画面の題。新規登録とログインで変えない（今どちらかはカードのタブが示す）。 */
    title: string;
    /** 確認番号で入る画面の題。ログインの入口だと分かる語にする。 */
    challenge: string;
    submit: { register: string; login: string };
    switchToOther: { href: string; label: string };
    otherLabel: string;
  }
> = {
  organizer: {
    title: "主催者アカウント",
    challenge: "主催者ログイン",
    submit: { register: "登録してはじめる", login: "ログイン" },
    switchToOther: { href: "/participant/login", label: "参加者としてログイン" },
    otherLabel: "出欠の履歴を残すなら、",
  },
  participant: {
    title: "参加者アカウント",
    challenge: "参加者ログイン",
    submit: { register: "登録して参加履歴を残す", login: "ログイン" },
    switchToOther: { href: "/auth/register", label: "主催者としてログイン" },
    otherLabel: "イベントを開く幹事なら、",
  },
};

/**
 * 認証画面の地の色を、入口の役割で分ける。
 * 主催者はログイン後の管理画面（薄い山吹）をそのまま使い、参加者は参加者の共通ヘッダーに
 * 寄せた薄い緑にする。同じ部品なので、色はここ 1 か所で決める（`deco/pop.css`）。
 */
function authPageClass(audience: AuthAudience): string {
  return audience === "participant"
    ? "page--form page--auth page--auth--participant stack"
    : "page--form page--auth page--auth--organizer stack";
}

function AuthEntry({ audience, inviteName }: { audience: AuthAudience; inviteName: string | null }) {
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
  // 共用端末で別の会員として入り直す。指定があるときだけ、既存セッションで飛ばさない。
  const switching = isSwitchingAccount(searchParams.get("switch"));
  const switchQuery = switching ? "&switch=1" : "";
  const googleError = GOOGLE_ERRORS[searchParams.get("error") ?? ""] ?? null;
  const [mode, setMode] = useState<AuthMode>(() => resolveInitialAuthMode(searchParams.get("mode"), hasExplicitNext));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(googleError);
  const [notice, setNotice] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  // 登録の送信が終わり、確認メールの案内を出す状態。ログインのフォームへは切り替えない。
  const [sent, setSent] = useState(false);
  const [adminConsoleRequired, setAdminConsoleRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 電話番号の確認画面も、確認済みかどうかをここで受け取る（画面側の二重取得をやめる）。
  const existing = useExistingSession(!switching);
  // 確認番号の入力を待っているなら、それは「別の会員で入り直す」途中なので飛ばさない。
  const pendingLoginCode = loginCodeStep && existing.pendingChallenge;

  // 紹介リンクのコードを30日だけ覚える。登録の入口は主催者・参加者の両方がこの画面なので、
  // 書く場所はここ1か所で足りる（Google のコールバックにも同じオリジンで送られる）。
  // Cookie へ移したあとは URL から `ref` を落とす。`router.replace` は使わない
  // （再取得と着地判定を動かさず、表示中の紹介者名も消さないため）。
  useEffect(() => {
    const code = searchParams.get("ref")?.trim();
    if (!code) return;
    document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=${REFERRAL_MAX_AGE}; samesite=lax`;

    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("ref");
    const query = rest.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [searchParams]);

  useEffect(() => {
    if (existing.state !== "authenticated" || !existing.user) return;
    // 電話番号の確認画面は、確認済みなら PhoneScreen が着地へ送る。
    if (phoneStep || pendingLoginCode) return;
    const destination = resolveSessionDestination({
      audience,
      basePath,
      hasExplicitNext,
      nextPath,
      phoneVerified: existing.user.phoneVerified,
      platformRole: existing.user.platformRole,
    });
    // 履歴に入口を残さない。戻っても同じ判定をやり直すだけになる。
    router.replace(destination);
    router.refresh();
  }, [audience, basePath, existing.state, existing.user, hasExplicitNext, nextPath, pendingLoginCode, phoneStep, router]);

  const finish = useCallback(
    async (phoneVerified: boolean, platformRole?: "MEMBER" | "ADMIN") => {
      await hydrateSession();
      if (!phoneVerified) {
        router.push(phoneStepHref(basePath, hasExplicitNext, nextPath));
        router.refresh();
        return;
      }
      // 管理者を管理コンソールへ送るのは、主催者入口で戻り先を指定されていないときだけ。
      router.push(resolveAuthLanding({ audience, hasExplicitNext, nextPath, platformRole }));
      router.refresh();
    },
    [audience, basePath, hasExplicitNext, nextPath, router],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // 応答を待つ間にラジオが動いても、送ったフォームの種類で分岐する。
    const submittedMode = mode;
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
          submittedMode === "register"
            ? { action: "register", name, email, password, audience }
            : { action: "login", email, password, audience },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as ProblemBody & {
        verificationRequired?: boolean;
        unverifiedEmail?: boolean;
        challengeRequired?: boolean;
        phoneVerified?: boolean;
        signupPending?: boolean;
        audience?: AuthAudience;
      };
      if (!res.ok) {
        if (body.error === "EMAIL_UNVERIFIED") setUnverified(true);
        if (body.error === "ADMIN_CONSOLE_REQUIRED") setAdminConsoleRequired(true);
        throw new Error(problemMessage(body, "認証に失敗しました"));
      }
      // パスワードマネージャへの保存を頼む。`fetch` 送信では保存の合図が出ないため、
      // パスワードが一致したここで明示的に呼ぶ。失敗しても認証は止めない。
      if (body.verificationRequired || body.challengeRequired || body.phoneVerified) {
        void savePasswordCredential({
          email,
          password,
          ...(submittedMode === "register" ? { name } : {}),
        });
      }
      if (body.signupPending) {
        // 登録途中（メール確認済み・電話未確認）の意向にパスワードが一致した。
        // 電話番号の確認から続ける。入口が変わるときは、別の入口の戻り先を持ち込まない。
        const targetAudience: AuthAudience = body.audience === "participant" ? "participant" : "organizer";
        const targetBase = targetAudience === "participant" ? "/participant/login" : "/auth/register";
        const carryNext = targetAudience === audience ? nextQuery : "";
        router.push(`${targetBase}?step=phone${carryNext}`);
        return;
      }
      if (body.verificationRequired) {
        if (body.unverifiedEmail) {
          // ログインで未確認だった。フォームはログインのまま、再送ボタンを出す（FE-AUTH-17）。
          setUnverified(true);
          setNotice(body.detail || "確認メールを送信しました。メールのリンクを開いてください。");
          setPassword("");
          return;
        }
        // 新規登録と既登録メールのどちらも同じ。登録のフォームのまま案内だけを出す（FE-AUTH-01）。
        // 案内は確認パネルの見出しと注記が持つ。detail をそのまま出すと同じ文面が重なる。
        setSent(true);
        setPassword("");
        return;
      }
      if (body.challengeRequired) {
        router.push(`${basePath}?step=login-code${nextQuery}${switchQuery}`);
        return;
      }
      // パスワードでログインできた回数。確認番号待ちへ回る経路は、照合の成功で 1 回だけ数える。
      trackEvent("login", { audience });
      await finish(Boolean(body.phoneVerified));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "認証に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  /** 登録とログインを切り替える。前の応答の案内を持ち越さない。 */
  const changeMode = (next: AuthMode) => {
    setMode(next);
    setSent(false);
    setNotice(null);
    setError(null);
    setUnverified(false);
    setAdminConsoleRequired(false);
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
      // 再送では、送り直した事実だけを出す。案内の本文はパネルかフォームが持つ。
      setNotice("確認メールを送り直しました。");
      setUnverified(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確認メールを再送できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  const completePhone = useCallback(
    (info?: { created?: boolean }) => {
      // 会員が実際にできたときだけ登録として数える。途中の再開・引き継ぎでは送らない。
      if (info?.created === true) trackEvent("sign_up", { audience });
      void finish(true);
    },
    [audience, finish],
  );

  const holdForSession =
    existing.state === "checking" ||
    (existing.state === "authenticated" && !phoneStep && !pendingLoginCode);
  if (holdForSession) {
    // ログイン済みならフォームを出さずに着地へ送る。判定中も同じ表示にして、
    // 一瞬だけ入力欄が見えて消えるのを避ける。
    return (
      <Loading>
        ログイン状態を確認しています
      </Loading>
    );
  }

  if (loginCodeStep) {
    return (
      <div className={authPageClass(audience)}>
        <LoginChallengeForm
          screenName={copy.challenge}
          onConfirmed={({ phoneVerified, platformRole }) => {
            // 確認番号でログインできた回数。
            trackEvent("login", { audience });
            void finish(phoneVerified, platformRole);
          }}
          onRestart={() =>
            router.push(
              `${basePath}${hasExplicitNext ? `?next=${encodeURIComponent(nextPath)}` : ""}${switchQuery}`,
            )
          }
        />
      </div>
    );
  }

  if (phoneStep) {
    return (
      <PhoneScreen
        audience={audience}
        basePath={basePath}
        nextPath={nextPath}
        signedIn={existing.state === "authenticated"}
        phoneVerified={existing.state === "authenticated" && existing.user?.phoneVerified === true}
        onFinished={completePhone}
      />
    );
  }

  return (
    <div className={authPageClass(audience)}>
      <PageHeader
        eyebrow={audience === "participant" ? "参加者" : "主催者"}
        title={copy.title}
      />
      <div className="auth-card auth-card--tabs">
        {/* 登録とログインの切り替え。カードの上端に敷く帯にして、今どちらかをここで示す。
            見た目はタブだが、意味は「2 つから 1 つを選ぶ」radio のまま（矢印キーで移れる）。 */}
        <div className="auth-tabs" role="group" aria-label="新規登録かログインか">
          <label className="auth-tabs__item">
            <input
              type="radio"
              name="auth-mode"
              checked={mode === "register"}
              onChange={() => changeMode("register")}
            />
            新規登録
          </label>
          <label className="auth-tabs__item">
            <input type="radio" name="auth-mode" checked={mode === "login"} onChange={() => changeMode("login")} />
            ログイン
          </label>
        </div>
        {/* 選んだタブが上辺でつながる面。入力欄はすべてこの中に置き、
            タブと面を 1 枚の紙として見せる（`deco/surface.css` の `.auth-card--tabs`）。 */}
        <div className="auth-card__panel">
          {sent && mode === "register" ? (
            <>
              <h2 className="auth-card__title">確認メールを送信しました</h2>
              <p className="auth-card__note">メールのリンクを開いてください。迷惑メールも見てください。</p>
              <div className="auth-card__body">
                <p>{`${email} 宛に送りました。`}</p>
                {notice && <Alert tone="success">{notice}</Alert>}
                {error && <Alert tone="error">{error}</Alert>}
              </div>
              <div className="panel__actions">
                <button
                  type="button"
                  className="btn btn--outline btn--block"
                  disabled={submitting || !email}
                  onClick={() => void resend()}
                >
                  確認メールを再送する
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--block"
                  disabled={submitting}
                  onClick={() => {
                    setSent(false);
                    setNotice(null);
                    setError(null);
                  }}
                >
                  メールアドレスを直す
                </button>
              </div>
            </>
          ) : (
            <>
              {/* mode ごとに作り直す。同じ要素の autocomplete を書き換えるだけでは、
                  Chrome が新しい用途（新規パスワード／既存パスワード）として解析し直さない。 */}
              <form key={mode} onSubmit={submit} className="auth-card__body">
                {/* 紹介の付与は新規登録のときだけ。ログインに切り替えたら出さない。 */}
                {mode === "register" && inviteName && (
                  <Alert tone="success">
                    {`${inviteName}さんの紹介です。はじめて公開すると、紹介した方にチケット${REFERRAL_TICKET_GRANT}枚が届きます。`}
                  </Alert>
                )}
                {mode === "register" && (
                  <Field label="名前" htmlFor="register-name">
                    <input
                      id="register-name"
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={50}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="input"
                    />
                  </Field>
                )}
                <Field label="メールアドレス" htmlFor="register-email">
                  <input
                    id="register-email"
                    name="email"
                    // パスワードマネージャのユーザー名としてメールアドレスを対応付ける。
                    autoComplete="username"
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="パスワード" htmlFor="register-password">
                  <input
                    id="register-password"
                    name="password"
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    required
                    type="password"
                    minLength={mode === "register" ? 8 : 1}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="input"
                  />
                </Field>
                {notice && <Alert tone="success">{notice}</Alert>}
                {error && <Alert tone="error">{error}</Alert>}
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
                  {submitting ? "処理中…" : mode === "register" ? copy.submit.register : copy.submit.login}
                </button>
              </form>
            </>
          )}
          {SHOW_GOOGLE_ENTRY && (
            <div className="panel__actions">
              <a
                href={`/api/v1/auth/google?audience=${audience}${hasExplicitNext ? `&next=${encodeURIComponent(nextPath)}` : ""}`}
                className="btn btn--outline btn--block"
              >
                Googleで続ける
              </a>
            </div>
          )}
          <div className="auth-alt">
            {copy.otherLabel}
            <Link href={copy.switchToOther.href} className="text-link">
              {copy.switchToOther.label}
            </Link>
            へ。
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneScreen({
  audience,
  basePath,
  nextPath,
  signedIn,
  phoneVerified,
  onFinished,
}: {
  audience: AuthAudience;
  basePath: string;
  nextPath: string;
  /** この端末に有効な会員セッションがある。 */
  signedIn: boolean;
  /** そのセッションの電話番号が確認済み。 */
  phoneVerified: boolean;
  /** 確認が終わったときに呼ぶ。新しい会員が作られたときだけ `created: true` が入る。 */
  onFinished: (info?: { created?: boolean }) => void;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 確認コードの入力ミスを使い切った状態。再送を前に出す。 */
  const [exhausted, setExhausted] = useState(false);
  /** 登録の意向を引けない状態（Cookie が無い・24 時間を過ぎた・別端末でメールを開いた）。 */
  const [subjectMissing, setSubjectMissing] = useState(false);

  // 既に確認済みの会員は、この画面を出さずに着地へ送る。
  useEffect(() => {
    if (phoneVerified) onFinished();
  }, [onFinished, phoneVerified]);

  /** 確認コードを送る。送り直しも同じ経路を通す。 */
  const request = async (kind: "send" | "resend") => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setSubjectMissing(false);
    try {
      const res = await fetch("/api/v1/auth/phone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = (await res.json().catch(() => ({}))) as ProblemBody & { alreadyVerified?: boolean };
      if (!res.ok) {
        // 401 は、意向 Cookie が無い・切れた・別端末でメールを開いた状態。行き止まりにしない。
        if (res.status === 401) setSubjectMissing(true);
        throw new Error(problemMessage(body, "確認コードを送れませんでした"));
      }
      if (body.alreadyVerified) {
        onFinished();
        return;
      }
      setSent(true);
      setExhausted(false);
      setCode("");
      setNotice(kind === "resend" ? "確認コードを送り直しました。" : body.detail || "確認コードを送信しました。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確認コードを送れませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  const start = (event: FormEvent) => {
    event.preventDefault();
    void request("send");
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
      if (!res.ok) {
        // 送ったあとに意向が切れた場合も、行き止まりにせず同じ再開の導線を出す。
        if (res.status === 401) setSubjectMissing(true);
        const problem = await readProblemBody(res);
        setExhausted(problem.error === "CODE_EXHAUSTED");
        throw new Error(problemMessage(problem, "電話番号の確認に失敗しました"));
      }
      const body = (await res.json()) as { attachedExisting?: boolean; reactivated?: boolean; created?: boolean };
      if (body.reactivated) {
        setNotice("以前のアカウントを引き継ぎました。チケットは前回の続きからになります。");
      } else if (body.attachedExisting) {
        setNotice("同じ電話番号の会員へ結びつけました。");
      }
      onFinished({ created: body.created === true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "電話番号の確認に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={authPageClass(audience)}>
      <PageHeader
        eyebrow={<>{audience === "participant" ? "参加者" : "主催者"}</>}
        title="電話番号の確認"
        lead={<>{audience === "participant"
            ? "履歴を残す会員は、確認済みの電話番号が必要です。メールアドレスや Google アカウントが違っても、同じ番号なら同じ会員になります。"
            : "無料チケットは、確認済みの電話番号 1 件につき 2 枚です。メールアドレスや Google アカウントが違っても、同じ番号なら同じ会員になります。"}{" "}
          確認後の移動先は {nextPath} です。
        </>}
      />
      <div className="auth-card">
        <h2 className="auth-card__title">{sent ? "確認番号で入る" : "電話番号で入る"}</h2>
        <p className="auth-card__note">
          {sent
            ? "登録した電話番号に 6桁の番号を送りました。届かないときは、下から送り直せます。"
            : "登録した電話番号に 6桁の番号を送ります。"}
        </p>
        <form onSubmit={sent ? confirm : start} className="auth-card__body">
          <Field label="電話番号" htmlFor="register-phone">
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
          </Field>
          {sent && (
            <Field label="確認コード（6桁）" htmlFor="register-phone-code">
              <input
                id="register-phone-code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="input code-input"
              />
            </Field>
          )}
          {notice && <Alert tone="success">{notice}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          {/* 主操作（朱）は増やさない。続きはログインフォームの同じパスワードで再開する。 */}
          {subjectMissing && (
            <p className="help">
              <Link href={`${basePath}?mode=login`} className="text-link">
                続きから再開
              </Link>
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn btn--primary btn--block">
            {submitting ? "処理中…" : sent ? "確認して続ける" : "確認コードを送る"}
          </button>
        </form>
        {sent && (
          <div className="panel__actions">
            <button
              type="button"
              disabled={submitting}
              className={exhausted ? "btn btn--primary btn--block" : "btn btn--outline btn--block"}
              onClick={() => void request("resend")}
            >
              確認コードを送り直す
            </button>
          </div>
        )}
        <p className="help">
          {signedIn ? (
            // ログイン済みの会員にログイン画面を出すと、また同じ画面へ戻ってしまう。
            <Link href={nextPath} className="text-link">
              あとで確認する
            </Link>
          ) : (
            <Link href={basePath} className="text-link">
              ログイン画面へ戻る
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}

export function AuthEntryScreen({
  audience,
  inviteName = null,
}: {
  audience: AuthAudience;
  /** 紹介リンクから来たときの紹介者名。取れなければ null。 */
  inviteName?: string | null;
}) {
  return (
    <Suspense
      fallback={
        <Loading>
          ログイン画面を準備しています
        </Loading>
      }
    >
      <AuthEntry audience={audience} inviteName={inviteName} />
    </Suspense>
  );
}
