import type { ReactNode } from "react";
import { PublicThemeShell } from "@/components/common/PublicThemeShell";
import { SampleBand } from "../../SampleBand";
import { findProfile } from "../../profiles";

/**
 * 見本の主催者プロフィールの器（SCR-PUB-18）。
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

export default function SampleProfileLayout({ params, children }: LayoutProps) {
  const profile = findProfile(params.slug);
  return (
    <PublicThemeShell themeId={profile?.profile.themeId} flush>
      <SampleBand />
      {children}
    </PublicThemeShell>
  );
}
