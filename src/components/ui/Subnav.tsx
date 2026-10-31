"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 画面の節。ヘッダーの真下に置く帯で、同じまとまりの画面だけを行き来させる。
 *
 * 主催者（`OrganizerTabs`）と参加者（`ParticipantTabs`）が同じ帯を使う。
 * 行き先と文言は呼び出し側が持ち、ここは「どれが現在地か」だけを決める。
 * 帯の見た目（`.subnav`）は `src/styles/deco/surface.css` が 1 か所で持つ。
 */
export interface SubnavItem {
  href: string;
  label: string;
  /**
   * 現在地の決め方。既定は配下の画面も現在地にする（`/participant/history?page=2` など）。
   * `exact` は完全一致だけ。一覧の先頭（`/organizer/events`）のように、
   * 配下に別の画面（作成・編集・名簿）を持つ行き先で使う。
   */
  match?: "prefix" | "exact";
}

export function Subnav({ label, items }: { label: string; items: readonly SubnavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="subnav" aria-label={label}>
      <div className="subnav__inner">
        {items.map((item) => {
          const current =
            item.match === "exact"
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={current ? "is-current" : undefined}
              aria-current={current ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
