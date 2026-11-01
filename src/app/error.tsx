"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui";

/**
 * 画面の途中で失敗したときの受け皿。`src/app/**` のエラーは、いちばん近いこれが受ける。
 *
 * ここが無いと、利用者には Next.js の英語のエラー画面が出るだけで、戻る道が無い。
 * 文言は「何が起きたか」「どうすればよいか」の 2 つだけにし、主操作は 1 つ（もう一度読み込む）にする。
 * 失敗の中身は開発者向けなので画面には出さず、`console.error` に残す（`digest` でサーバーのログと突き合わせる）。
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page--form stack">
      <h1 className="page-title">画面を開けませんでした</h1>
      <Alert tone="error">一時的な不具合のことがあります。もう一度読み込んでください。</Alert>
      <div className="panel__actions">
        <button type="button" className="btn btn--primary btn--block" onClick={reset}>
          もう一度読み込む
        </button>
        <Link href="/" className="btn btn--outline btn--block">
          トップへ
        </Link>
      </div>
      {error.digest && <p className="help">問い合わせのときは、この番号を伝えてください（{error.digest}）。</p>}
    </div>
  );
}
