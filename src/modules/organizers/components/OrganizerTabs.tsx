"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 主催者画面の本文内サブタブ。
 * ヘッダーの行き先（FE-PUB-03）は変えず、主催一覧・カレンダー・売上のあいだだけを行き来させる。
 * ヘッダーに同じ行き先を重ねないため、ここは「節」の切り替えとして置く。
 */
const TABS = [
  { href: "/organizer/events", label: "主催一覧" },
  { href: "/organizer/calendar", label: "カレンダー" },
  { href: "/organizer/revenue", label: "売上" },
  { href: "/organizer/profile", label: "プロフィール" },
] as const;

export function OrganizerTabs() {
  const pathname = usePathname();
  return (
    <nav className="organizer-tabs" aria-label="主催者の節">
      {TABS.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`organizer-tabs__link${current ? " is-current" : ""}`}
            aria-current={current ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
