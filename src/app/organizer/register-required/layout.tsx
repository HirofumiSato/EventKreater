import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * 公開直後の案内は幹事の端末だけに向けたもの。検索結果に載せない。
 * 画面本体はクライアントコンポーネントなので、metadata はこの layout で持つ。
 */
export const metadata: Metadata = {
  title: "イベントを公開しました",
  robots: { index: false, follow: false },
};

export default function RegisterRequiredLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
