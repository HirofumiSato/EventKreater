"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { readProblem } from "@/lib/problem";
import { Alert, Loading, PageHeader } from "@/components/ui";

function VerifyScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  // 参加者入口から始めた登録は、確認後の着地も参加者側へ寄せる。
  // replaceState でクエリを消しても着地がぶれないよう、最初の値を固定する。
  const [participant] = useState(() => searchParams.get("audience") === "participant");
  const basePath = participant ? "/participant/login" : "/auth/register";
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [nextStep, setNextStep] = useState<"phone" | "login" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const confirm = async () => {
    setStatus("pending");
    setMessage(null);
    try {
      const res = await fetch("/api/v1/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { next?: string };
      const next = body.next === "phone" ? "phone" : "login";
      setNextStep(next);
      setStatus("done");
      window.history.replaceState(null, "", "/auth/verify");
      if (next === "phone") {
        router.push(`${basePath}?step=phone`);
        return;
      }
    } catch (cause) {
      setStatus("error");
      setMessage(cause instanceof Error ? cause.message : "確認に失敗しました");
    }
  };

  return (
    <div className="page--form stack">
      <PageHeader
        eyebrow="確認"
        title="メールアドレスの確認"
        lead={<>{participant
            ? "リンク先の確認が終わると、電話番号の確認へ進みます。参加者ホームの準備ができたら、そのまま出欠の履歴を残せます。"
            : "リンク先の確認が終わると、電話番号の確認へ進みます。既に会員のときはログインしてください。"}</>}
      />
      {status === "done" ? (
        <Alert tone="success">
          {nextStep === "phone" ? "メールの確認が完了しました。電話番号を確認してください。" : "確認が完了しました。ログインしてください。"}
        </Alert>
      ) : null}
      {message && <Alert tone="error">{message}</Alert>}
      <div className="auth-card">
        <h2 className="auth-card__title">届いたメールを開く</h2>
        <p className="auth-card__note">
          メールのリンクを開くと確認が終わります。うまく開けないときは、下のボタンから確認できます。
        </p>
        <div className="panel__actions">
          {status === "done" ? null : (
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={!token || status === "pending"}
              onClick={() => void confirm()}
            >
              {status === "pending" ? "確認しています…" : "確認を完了する"}
            </button>
          )}
          <Link href={nextStep === "phone" ? `${basePath}?step=phone` : basePath} className="btn btn--ghost btn--block">
            {nextStep === "phone" ? "電話番号の確認へ" : "ログイン画面へ"}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <Loading>
          確認画面を準備しています
        </Loading>
      }
    >
      <VerifyScreen />
    </Suspense>
  );
}
