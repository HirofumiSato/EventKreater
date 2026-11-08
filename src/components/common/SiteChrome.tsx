"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/common/Navbar";
import { SiteFooter } from "@/components/common/SiteFooter";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import { ParticipantTabs } from "@/modules/participants/components/ParticipantTabs";
import { decoClassName, designScope } from "@/lib/design-scope";
import { showOrganizerTabs, showParticipantTabs, siteChrome } from "@/lib/site-chrome";

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // クロムの出し分けもパスだけで決まる。usePathname は初回描画から値を持つので、
  // サーバーとクライアントで同じクラスになり、色のちらつきが出ない。
  const chrome = siteChrome(pathname);
  // 装飾のスコープもパスだけで決まる。
  const scope = designScope(pathname);
  const deco = decoClassName(scope);

  return (
    <div className={deco || undefined}>
      {chrome.header ? <Navbar /> : null}
      {chrome.header && showOrganizerTabs(pathname) ? <OrganizerTabs /> : null}
      {chrome.header && showParticipantTabs(pathname) ? <ParticipantTabs /> : null}
      {/* テーマ付きの公開ページは、フッターをテーマの地の内側へ置くため、
          ページ側の器（`PublicThemeShell`）が main とフッターを持つ。 */}
      {chrome.main ? (
        <main id="main" className={chrome.flushTop ? "page page--flush" : "page"}>
          {children}
        </main>
      ) : (
        children
      )}
      {chrome.footer ? <SiteFooter /> : null}
    </div>
  );
}
