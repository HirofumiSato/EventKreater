"use client";

import { useState, type FormEvent } from "react";
import { readProblem } from "@/lib/problem";
import type { AccountProfile } from "@/modules/account/types";
import { Alert, Field, Panel } from "@/components/ui";

interface Props {
  profile: AccountProfile;
  onChange: (next: Partial<AccountProfile>) => void;
}

/** パスワードの変更。Google のみで登録した会員は、ここで初めてパスワードを設定できる。 */
export function PasswordPanel({ profile, onChange }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
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
    if (newPassword !== confirmPassword) {
      setError("新しいパスワードが確認用と一致しません。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPassword,
          ...(profile.hasPassword ? { currentPassword } : { code }),
        }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCode("");
      setNotice("パスワードを変更しました。他の端末のログインは解除されました。");
      onChange({ hasPassword: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "パスワードを変更できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="panel__title">パスワード</h2>
      <p className="panel__note">
        {profile.hasPassword
          ? "8文字以上で設定してください。変更すると、いま使っている端末以外のログインを解除します。"
          : "Google で登録したアカウントです。パスワードを設定すると、メールアドレスでもログインできます。"}
      </p>

      <form className="stack" onSubmit={(event) => void submit(event)}>
        {profile.hasPassword ? (
          <Field label="現在のパスワード" htmlFor="account-current-password">
            <input
              id="account-current-password"
              type="password"
              className="input"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={busy}
              required
            />
          </Field>
        ) : (
          <Field label="確認番号" htmlFor="account-password-code">
            <input
              id="account-password-code"
              className="input"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              disabled={busy}
              required
            />
            <p className="help">本人確認のため、登録済みの連絡先へ6桁の確認番号を送ります。</p>
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
          </Field>
        )}

        <Field label="新しいパスワード" htmlFor="account-new-password">
          <input
            id="account-new-password"
            type="password"
            className="input"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={busy}
            required
          />
        </Field>

        <Field label="新しいパスワード（確認）" htmlFor="account-confirm-password">
          <input
            id="account-confirm-password"
            type="password"
            className="input"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={busy}
            required
          />
        </Field>

        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "変更しています..." : "パスワードを変更"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
