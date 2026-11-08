import type { ReactNode } from "react";

/**
 * 見本の画面（SCR-PUB-16 / SCR-PUB-17 / SCR-PUB-18）の共通の枠。
 *
 * 帯（`SampleBand`）はここではなく、画面ごとに置く。詳細はテーマ付きの器
 * （`PublicThemeShell`）の中へ帯を入れる必要があり、一覧は共通の `main` の
 * 直下へ帯を置くため、置き場所が画面ごとに違う。
 */
export default function SampleLayout({ children }: { children: ReactNode }) {
  return children;
}
