"use client";

import Link from "next/link";
import { EmptyState, Section, SectionHead } from "@/components/ui";
import { NotificationRows } from "@/modules/notifications/components/NotificationRows";
import type { RsvpNotification } from "@/modules/notifications/types";

/**
 * 主催者マイページの「新着」。参加表明と参加要望を、新しい順に並べる。
 *
 * マイページはイベントの話が主役なので、通知は `limit` 件までにする。それ以上あるときは
 * 通知一覧（SCR-PUB-15）へ送る。件数の出し分けは画面側ではなくここが持つ。
 *
 * 見出しの右には「すべて既読にする」を置く。未読が無いときは押せない。
 * 行の形は `NotificationRows` が持つ（通知一覧と同じものを使う）。
 */

const DEFAULT_LIMIT = 4;

type NotificationListProps = {
  notifications: RsvpNotification[];
  unreadCount: number;
  /** 既読の送信中。二重に押せないようにする。 */
  marking: boolean;
  onMarkAll: () => void;
  onMarkOne: (notification: RsvpNotification) => void;
  onOpen: (notification: RsvpNotification) => void;
  /** この画面に出す上限。超えた分は `moreHref` の画面が受ける。 */
  limit?: number;
  /** 上限を超えたときに出す行き先。省くと行き先を出さない。 */
  moreHref?: string;
};

export function NotificationList({
  notifications,
  unreadCount,
  marking,
  onMarkAll,
  onMarkOne,
  onOpen,
  limit = DEFAULT_LIMIT,
  moreHref,
}: NotificationListProps) {
  const shown = notifications.slice(0, limit);
  const hasMore = notifications.length > shown.length;

  return (
    <Section id="notifications" className="notifications">
      <SectionHead title="新着">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onMarkAll}
          disabled={marking || unreadCount === 0}
        >
          すべて既読にする
        </button>
      </SectionHead>

      {shown.length === 0 ? (
        <EmptyState>
          まだありません。参加者が答えると、ここに出ます。
        </EmptyState>
      ) : (
        <>
          <NotificationRows
            notifications={shown}
            marking={marking}
            onMarkOne={onMarkOne}
            onOpen={onOpen}
          />
          {hasMore && moreHref ? (
            <div className="panel__actions">
              <Link href={moreHref} className="btn btn--outline btn--sm">
                通知一覧を見る
              </Link>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
