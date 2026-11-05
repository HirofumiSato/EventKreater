import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * 再設定のリンクは 1 回限りの権限を持つ。検索結果に載せない。
 * 画面本体はクライアントコンポーネントなので、metadata はこの layout で持つ。
 */
export const metadata: Metadata = {
  title: "パスワードの再設定",
  robots: { index: false, follow: false },
};

export default function PasswordResetLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
