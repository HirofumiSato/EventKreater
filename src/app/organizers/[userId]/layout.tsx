import type { ReactNode } from "react";
import { notFound } from "next/navigation";
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
  // 会員が無い・退会済みなら、器の段階で 404 にする。本文（`page.tsx`）の `notFound()` だけだと、
  // 骨格（`loading.tsx`）を先に流し終えていて HTTP の状態を変えられず、本文が「見つかりません」でも
  // 200 が返る（ソフト 404）。layout は骨格より外側なので、ここで止めれば 404 になる。
  if (!isUserId(params.userId)) notFound();
  const loaded = await loadPublicOrganizerProfileCached(params.userId);
  if (!loaded) notFound();

  return <PublicThemeShell themeId={loaded.profile.themeId}>{children}</PublicThemeShell>;
}
