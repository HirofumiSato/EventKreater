"use client";

import { SITE } from "@/lib/site";
import { Subnav, type SubnavItem } from "@/components/ui";

/**
 * 主催者画面の本文内サブタブ。
 * ヘッダーの行き先（FE-PUB-03）は変えず、主催者としての画面のあいだだけを行き来させる。
 * ヘッダーに同じ行き先を重ねないため、ここは「節」の切り替えとして置く。
 * 先頭の「ホーム」は `/mypage`（SCR-PUB-03）で、節のどの画面からでも戻れる。
 * 下書き（SCR-ORG-15）はイベントの一覧の一種なので、ここには置かず頭文字のメニューが持つ。
 */
const TABS: readonly SubnavItem[] = [
  SITE.nav.organizerHome,
  // 一覧の先頭は完全一致。配下の作成・編集・名簿で「主催一覧」を現在地にしない。
  { href: "/organizer/events", label: "主催一覧", match: "exact" },
  { href: "/organizer/calendar", label: "カレンダー" },
  { href: "/organizer/revenue", label: "売上" },
  { href: "/organizer/profile", label: "プロフィール" },
];

export function OrganizerTabs() {
  return <Subnav label="主催者の節" items={TABS} />;
}
