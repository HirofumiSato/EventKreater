"use client";

import { useEffect } from "react";

/**
 * いちばん外側（ルートの `layout.tsx`）で失敗したときの受け皿。
 *
 * `error.tsx` は `layout.tsx` の内側で受けるが、`layout.tsx` 自体が落ちたときは届かない。
 * ここは `layout.tsx` を置き換えて描くので、`html` と `body` を自分で出し、
 * 共有スタイル（`/styles/index.css`）も読まれない前提で書く。
 * そのため、この 1 ファイルだけはクラスではなく最小限の inline style を使う
 * （他の画面の見た目をそろえる規則の対象外。ここが出るのは最後の砦のときだけ）。
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <main
          style={{
            margin: "0 auto",
            maxWidth: "26rem",
            padding: "3rem 1.25rem",
            fontFamily: '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif',
            lineHeight: 1.8,
            color: "#1c1917",
            background: "#faf9f7",
            minHeight: "100vh",
          }}
        >
          <h1 style={{ fontSize: "1.375rem", margin: "0 0 0.75rem" }}>画面を開けませんでした</h1>
          <p style={{ margin: "0 0 1.5rem", fontSize: "0.9375rem" }}>
            一時的な不具合のことがあります。もう一度読み込んでください。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              display: "block",
              width: "100%",
              minHeight: "2.5rem",
              padding: "0.5rem 1rem",
              border: 0,
              borderRadius: "0.5rem",
              background: "#c2410c",
              color: "#fff",
              fontSize: "0.9375rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            もう一度読み込む
          </button>
          {error.digest && (
            <p style={{ margin: "1.5rem 0 0", fontSize: "0.8125rem", color: "#57534e" }}>
              問い合わせのときは、この番号を伝えてください（{error.digest}）。
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
