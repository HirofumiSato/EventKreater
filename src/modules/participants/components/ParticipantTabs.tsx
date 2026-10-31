"use client";

import { SITE } from "@/lib/site";
import { Subnav, type SubnavItem } from "@/components/ui";

/**
 * 参加者画面の本文内サブタブ。
 * 主催者の節（`OrganizerTabs`）と同じ帯（`.subnav`）を使い、参加者としての画面のあいだだけを行き来させる。
 *
 * 文言は短い名前にする。主催者の節と同じく、帯は「ホーム・カレンダー・参加履歴」の 3 本で足りる
 * （`SITE.nav` の「参加者ホーム」「参加カレンダー」は、主催者画面から参加者画面へ移るときの
 * 行き先の名前で、節の中では「ホーム」「カレンダー」と呼ぶ）。
 *
 * アカウント（`/account`）と、主催者でもある会員の「主催者マイページ」はここに置かない。
 * 同じ行き先を 2 か所に出すと、どちらが現在地か読めなくなる。頭文字のメニューが受ける。
 */
const TABS: readonly SubnavItem[] = [
  // 参加者ホームは完全一致。配下のカレンダー・履歴も `/participant/` で始まるため。
  { ...SITE.nav.participantHome, label: "ホーム", match: "exact" },
  { ...SITE.nav.participantCalendar, label: "カレンダー" },
  SITE.nav.participantHistory,
];

export function ParticipantTabs() {
  return <Subnav label="参加者の節" items={TABS} />;
}
