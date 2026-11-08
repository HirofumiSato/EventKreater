import type { ReactNode } from "react";
import { PublicThemeShell } from "@/components/common/PublicThemeShell";
import { isUserId } from "@/lib/ids";
import { loadPublicOrganizerProfileCached } from "@/modules/organizers/lib/profile-store";

/**
 * 主催者の公開ページの器（SCR-PUB-14）。
 *
 * テーマは本文ではなくここが持ち、`<main>` とフッターを器へ渡す（`siteChrome()` は
 * このパスで `main: false` を返す）。プロフィールが無いときも 404 はこの layout の
 * 中で描かれるので、`main` とフッターは消えない。テーマが無ければ器は要素を増やさない。
 */
interface LayoutProps {
  params: { userId: string };
  children: ReactNode;
}

export default async function OrganizerProfileLayout({ params, children }: LayoutProps) {
  // 形の違う ID は本文が 404 にする。ここでは読みに行かない（`page.tsx` と同じ判定）。
  const loaded = isUserId(params.userId)
    ? await loadPublicOrganizerProfileCached(params.userId)
    : null;

  return <PublicThemeShell themeId={loaded?.profile.themeId}>{children}</PublicThemeShell>;
}
