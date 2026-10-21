"use client";

import { useState, type FormEvent } from "react";
import { readProblem } from "@/lib/problem";
import type { AccountProfile } from "@/modules/account/types";

interface Props {
  profile: AccountProfile;
}

/**
 * 退会。論理削除なので、同じ電話番号で再登録すると前のアカウントを引き継ぐ。
 * ただし、筆頭幹事のイベントは閉じられ、サブスクリプションは即時解約される。
 */
export function WithdrawPanel({ profile }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendReauthCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/user/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { destinationMask: string };
      setCodeSent(true);
      setNotice(`確認番号を ${body.destinationMask} へ送りました。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確認番号を送れませんでした");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phrase,
          ...(profile.hasPassword ? { password } : { code }),
        }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      // 退会するとセッションは無効になる。トップへ戻してログイン状態を捨てる。
      window.location.href = "/?withdrawn=1";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "退会できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">退会</h2>
      <p className="panel__note panel__note--warning">
        退会するとログインできなくなります。あなたが筆頭幹事のイベントは閉じられ、公開中のページも見られなくなります。
        共同幹事として参加しているイベントは、あなたの幹事権限だけが外れます。
      </p>
      <p className="panel__note">
        電話番号は再登録の確認のために残します。同じ電話番号で登録し直すと、以前のアカウントと利用枠を引き継ぎます。
        無料枠が戻ることはありません。
      </p>

      {!open && (
        <div className="btn-row">
          <button type="button" className="btn btn--danger" onClick={() => setOpen(true)}>
            退会の手続きへ
          </button>
        </div>
      )}

      {open && (
        <form className="stack" onSubmit={(event) => void submit(event)}>
          {profile.hasPassword ? (
            <div className="field">
              <label className="label" htmlFor="withdraw-password">
                現在のパスワード
              </label>
              <input
                id="withdraw-password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                required
              />
            </div>
          ) : (
            <div className="field">
              <label className="label" htmlFor="withdraw-code">
                確認番号
              </label>
              <input
                id="withdraw-code"
                className="input"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                disabled={busy}
                required
              />
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  disabled={busy}
                  onClick={() => void sendReauthCode()}
                >
                  {codeSent ? "確認番号を再送する" : "確認番号を送る"}
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="withdraw-phrase">
              確認のため「退会」と入力してください
            </label>
            <input
              id="withdraw-phrase"
              className="input"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              disabled={busy}
              placeholder="退会"
              required
            />
          </div>

          {notice && <p className="alert alert--info">{notice}</p>}
          {error && <p className="alert alert--error">{error}</p>}

          <div className="btn-row">
            <button
              type="submit"
              className="btn btn--danger"
              disabled={busy || phrase !== "退会"}
            >
              {busy ? "手続きしています..." : "退会する"}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setPassword("");
                setCode("");
                setPhrase("");
                setNotice(null);
                setError(null);
              }}
            >
              やめる
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
