"use client";

import { useState, type FormEvent } from "react";
import { readProblem } from "@/lib/problem";
import type { AccountProfile } from "@/modules/account/types";
import { Alert, Field } from "@/components/ui";

interface Props {
  profile: AccountProfile;
  onChange: (next: Partial<AccountProfile>) => void;
}

/** 電話番号の変更。パスワードが無い会員は、確認番号を送ってから変更する。 */
export function PhoneChangePanel({ profile, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [reauthCode, setReauthCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setOpen(false);
    setPhone("");
    setPassword("");
    setCode("");
    setReauthCode("");
    setCodeSent(false);
    setSmsSent(false);
    setNotice(null);
    setError(null);
  };

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

  const startChange = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/user/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          ...(profile.hasPassword ? { password } : { code: reauthCode }),
        }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { maskedPhone: string };
      setSmsSent(true);
      setNotice(`${body.maskedPhone} へ確認コードを送りました。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "確認コードを送れませんでした");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/user/phone/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { phoneMasked: string; phoneVerified: boolean };
      onChange({ phoneMasked: body.phoneMasked, phoneVerified: body.phoneVerified });
      setNotice("電話番号を変更しました。他の端末のログインは解除されました。");
      setOpen(false);
      setPhone("");
      setPassword("");
      setCode("");
      setReauthCode("");
      setCodeSent(false);
      setSmsSent(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "電話番号を変更できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div>
        <p className="label">現在の登録</p>
        <p>{profile.phoneVerified && profile.phoneMasked ? profile.phoneMasked : "未登録"}</p>
        <p className="help">無料枠の判定と、ログイン時の確認番号に使います。変更すると新しい番号へSMSが届きます。</p>
      </div>

      {!open && (
        <div className="btn-row">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(true)}>
            電話番号を変更する
          </button>
        </div>
      )}

      {open && !smsSent && (
        <form className="stack" onSubmit={(event) => void startChange(event)}>
          <Field label="新しい電話番号" htmlFor="account-phone">
            <input
              id="account-phone"
              className="input"
              inputMode="tel"
              placeholder="09012345678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={busy}
              required
            />
          </Field>

          {profile.hasPassword ? (
            <Field label="現在のパスワード" htmlFor="account-phone-password">
              <input
                id="account-phone-password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                required
              />
            </Field>
          ) : (
            <Field label="確認番号" htmlFor="account-phone-code">
              <input
                id="account-phone-code"
                className="input"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={reauthCode}
                onChange={(event) => setReauthCode(event.target.value.replace(/\D/g, ""))}
                disabled={busy}
                required
              />
              <p className="help">
                パスワードを設定していないため、登録済みの連絡先へ確認番号を送って本人確認します。
              </p>
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

          {notice && <Alert tone="info">{notice}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <div className="btn-row">
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
              {busy ? "送信しています…" : "新しい番号へSMSを送る"}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>
              やめる
            </button>
          </div>
        </form>
      )}

      {open && smsSent && (
        <form className="stack" onSubmit={(event) => void confirm(event)}>
          <Field label="新しい番号に届いた確認コード" htmlFor="account-phone-confirm">
            <input
              id="account-phone-confirm"
              className="input"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              disabled={busy}
              required
            />
          </Field>
          {notice && <Alert tone="info">{notice}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <div className="btn-row">
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
              {busy ? "確認しています…" : "この番号に変更する"}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>
              やめる
            </button>
          </div>
        </form>
      )}

      {!open && notice && <Alert tone="success">{notice}</Alert>}
      {!open && error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
