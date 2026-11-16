"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readProblem } from "@/lib/problem";
import { Alert } from "@/components/ui";

/**
 * 招待の受諾だけを持つクライアント部品。
 *
 * 表示（イベント名・日程・料金・有効期限）はサーバーが描く。ここに残すのは
 * 押した後にしか起きないこと（POST・失敗の表示・管理画面への移動）だけ。
 * 送信先と、成功後に移る URL は以前と同じ（`manageUrl` をそのまま使う）。
 */
export function AcceptInvitation({ code }: { code: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/invitations/${code}`, { method: "POST" });
      if (!res.ok) throw new Error(await readProblem(res));
      const result = (await res.json()) as { manageUrl: string };
      router.push(result.manageUrl);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "受諾に失敗しました");
      setPending(false);
    }
  };

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      <button
        type="button"
        disabled={pending}
        onClick={() => void accept()}
        className="btn btn--primary btn--block"
      >
        {pending ? "参加処理中…" : "共同主催・幹事として参加する"}
      </button>
    </>
  );
}
