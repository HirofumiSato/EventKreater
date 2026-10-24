"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { readProblem } from "@/lib/problem";

type State = "working" | "done" | "error" | "missing";

function EmailVerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>(token ? "working" : "missing");
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void fetch("/api/v1/user/email/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readProblem(res));
        return (await res.json()) as { email: string };
      })
      .then((body) => {
        if (!active) return;
        setEmail(body.email);
        setState("done");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setMessage(cause instanceof Error ? cause.message : "確認に失敗しました");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="page--form stack">
      <div>
        <p className="eyebrow">確認</p>
        <h1 className="page-title">メールアドレスの確認</h1>
        <p className="page-lead">確認が終わると、新しいアドレスでログインできます。</p>
      </div>

      {state === "working" && <p className="help">確認しています...</p>}

      {state === "missing" && (
        <p className="alert alert--warning">
          確認リンクが正しくありません。アカウント画面からもう一度やり直してください。
        </p>
      )}

      {state === "done" && (
        <p className="alert alert--success">
          {email ? `${email} に変更しました。` : "メールアドレスを変更しました。"}
          他の端末のログインは解除されました。この端末から開いた場合は、そのまま続けられます。
        </p>
      )}

      {state === "error" && <p className="alert alert--error">{message}</p>}

      <div className="panel">
        <p className="panel__title">次にやること</p>
        <ul className="rows">
          <li className="rows__item">
            <div className="rows__main">
              <p className="rows__title">アカウント設定に戻る</p>
              <p className="rows__meta">電話番号とパスワードは、アカウント設定から変えられます。</p>
            </div>
            <Link href="/account" className="btn btn--ghost btn--sm">
              開く
            </Link>
          </li>
          <li className="rows__item">
            <div className="rows__main">
              <p className="rows__title">トップへ戻る</p>
              <p className="rows__meta">主催者の催しと、参加した催しの入口があります。</p>
            </div>
            <Link href="/" className="btn btn--ghost btn--sm">
              開く
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default function EmailVerifyPage() {
  return (
    <Suspense fallback={<p className="help">読み込んでいます...</p>}>
      <EmailVerifyInner />
    </Suspense>
  );
}
