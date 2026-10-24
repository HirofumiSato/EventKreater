"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { readProblem } from "@/lib/problem";
import { Alert, PageHeader, Panel, Row, Rows } from "@/components/ui";

type State = "working" | "done" | "error" | "missing";

function EmailVerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>(token ? "working" : "missing");
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  // 確認トークンは 1 回しか使えない。開発時の二重実行で 2 回目が 400 にならないよう、
  // 同じトークンの送信は 1 度だけにして、結果は使い回す。
  const requestRef = useRef<{ token: string; result: Promise<{ email: string }> } | null>(null);

  useEffect(() => {
    if (!token) return;
    if (requestRef.current?.token !== token) {
      const result = fetch("/api/v1/user/email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).then(async (res) => {
        if (!res.ok) throw new Error(await readProblem(res));
        return (await res.json()) as { email: string };
      });
      requestRef.current = { token, result };
    }
    let active = true;
    requestRef.current.result
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
      <PageHeader eyebrow="確認" title="メールアドレスの確認" lead="確認が終わると、新しいアドレスでログインできます。" />

      {state === "working" && <p className="help">確認しています...</p>}

      {state === "missing" && (
        <Alert tone="warning">
          確認リンクが正しくありません。アカウント画面からもう一度やり直してください。
        </Alert>
      )}

      {state === "done" && (
        <Alert tone="success">
          {email ? `${email} に変更しました。` : "メールアドレスを変更しました。"}
          他の端末のログインは解除されました。この端末から開いた場合は、そのまま続けられます。
        </Alert>
      )}

      {state === "error" && <Alert tone="error">{message}</Alert>}

      <Panel as="div">
        <p className="panel__title">次にやること</p>
        <Rows>
          <Row
            title="アカウント設定に戻る"
            meta="電話番号とパスワードは、アカウント設定から変えられます。"
            aside={<><Link href="/account" className="btn btn--ghost btn--sm">
              開く
            </Link></>}
          />
          <Row
            title="トップへ戻る"
            meta="主催者の催しと、参加した催しの入口があります。"
            aside={<><Link href="/" className="btn btn--ghost btn--sm">
              開く
            </Link></>}
          />
        </Rows>
      </Panel>
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
