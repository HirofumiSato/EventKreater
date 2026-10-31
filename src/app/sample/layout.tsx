import type { ReactNode } from "react";
import { SampleBand } from "./SampleBand";

/**
 * 見本の画面（SCR-PUB-16 / SCR-PUB-17）の共通の枠。
 *
 * 帯を本文より先に置き、`main`（`siteChrome` が `flushTop` を立てる）の上端から出す。
 * 一覧と詳細のどちらも、最初に「これは見本だ」と分かる状態で開く。
 */
export default function SampleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SampleBand />
      {children}
    </>
  );
}
