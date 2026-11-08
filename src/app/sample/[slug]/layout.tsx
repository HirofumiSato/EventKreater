import type { ReactNode } from "react";
import { PublicThemeShell } from "@/components/common/PublicThemeShell";
import { SampleBand } from "../SampleBand";
import { findSample } from "../samples";

/**
 * 見本の告知ページの器（SCR-PUB-17）。
 *
 * 帯は器の中の `main` の直下に置き、画面の上端から出す（`flush`）。
 * テーマは本文ではなくここが持ち、`<main>` とフッターを器へ渡す
 * （`siteChrome()` はこのパスで `main: false` を返す）。
 * 知らない slug でも layout は走るので、404 のときも `main` とフッターは消えない。
 */
interface LayoutProps {
  params: { slug: string };
  children: ReactNode;
}

export default function SampleEventLayout({ params, children }: LayoutProps) {
  const event = findSample(params.slug);
  return (
    <PublicThemeShell themeId={event?.themeId} flush>
      <SampleBand />
      {children}
    </PublicThemeShell>
  );
}
