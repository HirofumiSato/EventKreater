"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { loginEntryUrl, passwordResetUrl } from "@/lib/auth-links";
import { readProblem } from "@/lib/problem";
import { Alert, Field, Loading, PageHeader } from "@/components/ui";

type AuthAudience = "organizer" | "participant";

/**
 * 画面の状態。
 * `sent` はメールの依頼、`done` は新しいパスワードの確定、`invalid` はリンクが使えない状態。
 */
type Status = "idle" | "pending" | "sent" | "done" | "invalid";

function PasswordResetScreen() {
  const searchParams = useSearchParams();
  // メールのリンクは `?token=...` を持ち、確定の画面になる。無ければ依頼の画面。
  const token = searchParams.get("token") ?? "";
  // リンクは役割ごとの着地へ戻す。既定は主催者。
  const audience: AuthAudience = searchParams.get("audience") === "participant" ? "participant" : "organizer";
  // 依頼の画面へ戻るときも、入口の役割を落とさない。
  const requestHref = passwordResetUrl(audience);

  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submitting = status === "pending";

  /** リンクを送る。会員かどうかは応答で分けない（API が同じ応答を返す）。 */
  const request = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("pending");
    setMessage(null);
    try {
      const res = await fetch("/api/v1/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, audience }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      setStatus("sent");
    } catch (cause) {
      setStatus("idle");
      setMessage(cause instanceof Error ? cause.message : "リンクを送れませんでした");
    }
  };

  /** 新しいパスワードを確定する。送る前に、長さと一致だけをここで見る。 */
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      // 長さの案内は欄の下（`help`）が持つ。ブラウザも `minLength` で送信を止める。
      // ここは、その検証を通らない環境でも API へ送らないための控え。
      return;
    }
    if (password !== confirmation) {
      setMessage("パスワードが一致しません。");
      return;
    }
    setStatus("pending");
    setMessage(null);
    try {
      const res = await fetch("/api/v1/auth/password/reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        // 期限切れ・使用済み・見つからないリンクは、送り直しへ回す。
        setStatus(res.status === 400 ? "invalid" : "idle");
        setMessage(await readProblem(res));
        return;
      }
      setStatus("done");
      // 使い終わったリンクを、履歴と URL に残さない。
      window.history.replaceState(null, "", "/auth/password/reset");
    } catch (cause) {
      setStatus("idle");
      setMessage(cause instanceof Error ? cause.message : "再設定できませんでした");
    }
  };

  /** 宛先を入れ直す。前の応答の案内は持ち越さない。 */
  const resetForm = () => {
    setStatus("idle");
    setMessage(null);
    setEmail("");
  };

  return (
    <div className="page--form stack">
      <PageHeader
        eyebrow={audience === "participant" ? "参加者" : "主催者"}
        title="パスワードの再設定"
        lead={<>{token
          ? "新しいパスワードを決めてください。"
          : "登録したメールアドレスに、再設定のリンクを送ります。"}</>}
      />
      {message && <Alert tone="error">{message}</Alert>}
      {status === "sent" ? (
        <div className="auth-card">
          <h2 className="auth-card__title">リンクを送りました</h2>
          <p className="auth-card__note">メールのリンクを開いてください。迷惑メールも見てください。</p>
          <div className="auth-card__body">
            <p>{`${email} 宛に送りました。`}</p>
          </div>
          <div className="panel__actions">
            <button type="button" className="btn btn--ghost btn--block" onClick={resetForm}>
              メールアドレスを直す
            </button>
          </div>
        </div>
      ) : status === "done" ? (
        <div className="auth-card">
          <h2 className="auth-card__title">パスワードを再設定しました</h2>
          <p className="auth-card__note">新しいパスワードでログインしてください。</p>
          <div className="panel__actions">
            <Link href={loginEntryUrl(audience)} className="btn btn--primary btn--block">
              ログインへ
            </Link>
          </div>
        </div>
      ) : token ? (
        <div className="auth-card">
          <h2 className="auth-card__title">新しいパスワード</h2>
          <p className="auth-card__note">このアカウントのログイン中の端末は、すべてログアウトします。</p>
          <form onSubmit={confirm} className="auth-card__body">
            <Field label="新しいパスワード" htmlFor="reset-password" help="8文字以上で入力してください。">
              <input
                id="reset-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input"
              />
            </Field>
            <Field label="確認のためもう一度" htmlFor="reset-password-confirm">
              <input
                id="reset-password-confirm"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="input"
              />
            </Field>
            <button type="submit" disabled={submitting} className="btn btn--primary btn--block">
              {submitting ? "処理中…" : "再設定する"}
            </button>
          </form>
          {status === "invalid" ? (
            <div className="panel__actions">
              <Link href={requestHref} className="btn btn--outline btn--block">
                リンクを送り直す
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="auth-card">
          <h2 className="auth-card__title">メールアドレスを入れる</h2>
          <p className="auth-card__note">リンクの有効期限は 30 分です。</p>
          <form onSubmit={request} className="auth-card__body">
            <Field label="メールアドレス" htmlFor="reset-email">
              <input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input"
              />
            </Field>
            <button type="submit" disabled={submitting} className="btn btn--primary btn--block">
              {submitting ? "処理中…" : "リンクを送る"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function PasswordResetPage() {
  return (
    <Suspense
      fallback={
        <Loading>
          再設定の画面を準備しています
        </Loading>
      }
    >
      <PasswordResetScreen />
    </Suspense>
  );
}
