"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE } from "@/lib/site";

/**
 * 主催者画面の本文内サブタブ。
 * ヘッダーの行き先（FE-PUB-03）は変えず、主催者としての画面のあいだだけを行き来させる。
 * ヘッダーに同じ行き先を重ねないため、ここは「節」の切り替えとして置く。
 * 先頭の「ホーム」は `/mypage`（SCR-PUB-03）で、節のどの画面からでも戻れる。
 * 下書き（SCR-ORG-15）はイベントの一覧の一種なので、ここには置かず頭文字のメニューが持つ。
 */
const TABS = [
  SITE.nav.organizerHome,
  { href: "/organizer/events", label: "主催一覧" },
  { href: "/organizer/calendar", label: "カレンダー" },
  { href: "/organizer/revenue", label: "売上" },
  { href: "/organizer/profile", label: "プロフィール" },
] as const;

export function OrganizerTabs() {
  const pathname = usePathname();
  return (
    <nav className="org-subnav" aria-label="主催者の節">
      <div className="org-subnav__inner">
        {TABS.map((tab) => {
          // 下書きは配下の画面（プレビューなど）でも現在地にする。
          const current =
            tab.href === "/organizer/events"
              ? pathname === tab.href
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={current ? "is-current" : undefined}
              aria-current={current ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
