"use client";

import { useState, type FormEvent } from "react";
import { readProblem } from "@/lib/problem";
import type { AccountProfile, ReauthChallenge } from "@/modules/account/types";
import { Alert, Field, Panel } from "@/components/ui";

interface Props {
  profile: AccountProfile;
  onChange: (next: Partial<AccountProfile>) => void;
}

type EmailStep = "idle" | "reauth" | "newEmail" | "sent";

export function AccountInfoPanel({ profile, onChange }: Props) {
  const [name, setName] = useState(profile.name);
  const [nameStatus, setNameStatus] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [emailStep, setEmailStep] = useState<EmailStep>("idle");
  const [emailChallenge, setEmailChallenge] = useState<ReauthChallenge | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setSavingName(true);
    setNameError(null);
    setNameStatus(null);
    try {
      const res = await fetch("/api/v1/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { user: { id: string; email: string; name: string } };
      onChange({ name: body.user.name });
      setNameStatus("表示名を変更しました。");
    } catch (cause) {
      setNameError(cause instanceof Error ? cause.message : "変更に失敗しました");
    } finally {
      setSavingName(false);
    }
  };

  const startEmailReauth = async (channel: "SMS" | "EMAIL") => {
    setEmailBusy(true);
    setEmailError(null);
    setEmailNotice(null);
    try {
      const res = await fetch("/api/v1/user/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as ReauthChallenge;
      setEmailChallenge(body);
      setEmailStep("newEmail");
      setEmailNotice(`確認番号を ${body.destinationMask} へ送りました。`);
    } catch (cause) {
      setEmailError(cause instanceof Error ? cause.message : "確認番号を送れませんでした");
    } finally {
      setEmailBusy(false);
    }
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    setEmailBusy(true);
    setEmailError(null);
    setEmailNotice(null);
    try {
      const res = await fetch("/api/v1/user/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: emailCode, newEmail }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { maskedEmail: string };
      setEmailStep("sent");
      setEmailNotice(
        `${body.maskedEmail} へ確認リンクを送りました。メールのリンクを開くと変更が完了します。`,
      );
    } catch (cause) {
      setEmailError(cause instanceof Error ? cause.message : "変更を開始できませんでした");
    } finally {
      setEmailBusy(false);
    }
  };

  const resetEmail = () => {
    setEmailStep("idle");
    setEmailChallenge(null);
    setEmailCode("");
    setNewEmail("");
    setEmailError(null);
    setEmailNotice(null);
  };

  return (
    <>
      <Panel>
        <h2 className="panel__title">表示名</h2>
        <p className="panel__note">名簿と領収書に、この名前が入ります。</p>
        <form className="stack" onSubmit={(event) => void saveName(event)}>
          <Field label="表示名" htmlFor="account-name">
            <input
              id="account-name"
              className="input"
              value={name}
              maxLength={50}
              onChange={(event) => setName(event.target.value)}
              disabled={savingName}
            />
            <p className="help">1〜50文字。領収書の発行者名など、これから作る書類に使われます。</p>
          </Field>
          {nameError && <Alert tone="error">{nameError}</Alert>}
          {nameStatus && <Alert tone="success">{nameStatus}</Alert>}
          <div className="panel__actions">
            <button type="submit" className="btn btn--primary btn--sm" disabled={savingName || !name.trim()}>
              {savingName ? "保存しています..." : "表示名を保存"}
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        <h2 className="panel__title">メールアドレス</h2>
        <p className="panel__note">
          変更すると、新しいアドレスに確認のリンクが届きます。届くまで、変更は確定しません。
        </p>
        <div className="stack">
          <div>
            <p className="label">現在のメールアドレス</p>
            <p>{profile.email}</p>
            <p className="help">ログインと確認メールの宛先に使います。</p>
          </div>

          {emailStep === "idle" && (
            <div className="panel__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => setEmailStep("reauth")}
              >
                メールアドレスを変更する
              </button>
            </div>
          )}

          {emailStep === "reauth" && (
            <div className="stack">
              <p className="label">本人確認</p>
              <p className="help">
                変更する前に、登録済みの連絡先へ確認番号を送ります。受け取れる方法を選んでください。
              </p>
              <div className="btn-row">
                {profile.phoneVerified && profile.phoneMasked && (
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    disabled={emailBusy}
                    onClick={() => void startEmailReauth("SMS")}
                  >
                    SMS（{profile.phoneMasked}）
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  disabled={emailBusy}
                  onClick={() => void startEmailReauth("EMAIL")}
                >
                  メール（{profile.email}）
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={resetEmail}>
                  やめる
                </button>
              </div>
            </div>
          )}

          {emailStep === "newEmail" && (
            <form className="stack" onSubmit={(event) => void submitEmail(event)}>
              <Field label="確認番号" htmlFor="email-code">
                <input
                  id="email-code"
                  className="input code-input"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))}
                  disabled={emailBusy}
                  required
                />
                <p className="help">
                  {emailChallenge ? `${emailChallenge.destinationMask} へ6桁の番号を送りました。` : ""}
                </p>
              </Field>
              <Field label="新しいメールアドレス" htmlFor="new-email">
                <input
                  id="new-email"
                  type="email"
                  className="input"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  disabled={emailBusy}
                  required
                />
              </Field>
              <div className="panel__actions">
                <button type="submit" className="btn btn--primary btn--sm" disabled={emailBusy}>
                  {emailBusy ? "送信しています..." : "確認リンクを送る"}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={resetEmail}>
                  やめる
                </button>
              </div>
            </form>
          )}

          {emailStep === "sent" && (
            <div className="panel__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={resetEmail}>
                閉じる
              </button>
            </div>
          )}

          {emailNotice && <Alert tone="info">{emailNotice}</Alert>}
          {emailError && <Alert tone="error">{emailError}</Alert>}
        </div>
      </Panel>
    </>
  );
}
