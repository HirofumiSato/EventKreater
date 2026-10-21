"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { readProblem } from "@/lib/problem";
import { LoginChallengeForm } from "@/modules/auth/components/LoginChallengeForm";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/admin/session").then((res) => {
      if (active && res.ok) router.replace("/console");
    });
    return () => {
      active = false;
    };
  }, [router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { challengeRequired?: boolean };
      if (body.challengeRequired) {
        setChallenge(true);
        return;
      }
      router.replace("/console");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "認証に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (challenge) {
    return (
      <div className="page--form stack">
        <LoginChallengeForm
          screenName="管理者ログイン"
          onConfirmed={() => {
            router.replace("/console");
            router.refresh();
          }}
          onRestart={() => setChallenge(false)}
        />
      </div>
    );
  }

  return (
    <div className="page--form stack">
      <div>
        <h1 className="page-title">管理者ログイン</h1>
        <p className="page-lead">管理者権限と確認済みの電話番号が必要です。パスワードのあと、登録済みの電話へSMSで確認番号を送ります。主催者向けのログイン画面からは管理者として入れません。</p>
      </div>
      <form onSubmit={submit} className="form">
        <div className="field">
          <label className="label" htmlFor="admin-email">
            メールアドレス
          </label>
          <input
            id="admin-email"
            required
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="admin-password">
            パスワード
          </label>
          <input
            id="admin-password"
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input"
          />
        </div>
        {error ? <p className="alert alert--error">{error}</p> : null}
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? "確認しています" : "ログイン"}
        </button>
      </form>
    </div>
  );
}
