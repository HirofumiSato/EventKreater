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
      <section className="panel">
        <h1 className="page-title">メールアドレスの変更</h1>

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

        <div className="btn-row">
          <Link href="/account" className="btn btn--primary">
            アカウントへ
          </Link>
          <Link href="/" className="btn btn--ghost">
            トップへ
          </Link>
        </div>
      </section>
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
