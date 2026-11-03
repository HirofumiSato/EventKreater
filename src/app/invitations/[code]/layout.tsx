import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * 招待 URL は共同主催の権限を持つ。検索結果に載せない。
 * 画面本体はクライアントコンポーネントなので、metadata はこの layout で持つ。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function InvitationLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
