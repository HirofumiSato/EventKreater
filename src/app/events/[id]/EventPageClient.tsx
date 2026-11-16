"use client";

import { useState } from "react";
import Link from "next/link";
import { PosterHero } from "@/modules/events/components/PosterHero";
import { EventMetaCard } from "@/modules/events/components/EventMetaCard";
import { DynamicRsvpBox } from "@/modules/attendance/components/DynamicRsvpBox";
import { StickyRsvpBar } from "@/modules/attendance/components/StickyRsvpBar";
import { OrganizerInviteCard } from "@/modules/events/components/OrganizerInviteCard";
import { showsOrganizerInvite } from "@/modules/events/lib/organizer-invite";
import type { PublicEvent } from "@/modules/events/types";

/**
 * 告知ページの中身。
 *
 * データはサーバーが引いて `initialEvent` で渡す（本文は HTML に載る）。
 * この部品が持つのは、押した後だけ変わる状態（出欠の層・答えたか・人数）だけ。
 * 読み込み直しはしない。出欠の送信結果は `DynamicRsvpBox` が受け取り、
 * 人数だけを `onCountChange` でここへ返す。
 */
export default function PublicEventPage({ initialEvent }: { initialEvent: PublicEvent }) {
  const [event, setEvent] = useState<PublicEvent>(initialEvent);
  /** 出欠の層を開いているか。面のボタンと画面下の帯が、同じ 1 枚を開く。 */
  const [rsvpOpen, setRsvpOpen] = useState(false);
  /**
   * 答えたかどうか。`myRsvp` は読み込み時の写しなので、答えた直後に帯の文言を
   * 切り替えるには、こちらで上書きする（null の間は読み込み時の値に従う）。
   */
  const [answered, setAnswered] = useState<boolean | null>(null);

  const full = event.capacity !== null && event.attendingCount >= event.capacity;
  const hasAnswered = answered ?? Boolean(event.myRsvp);

  // テーマはページ側の器（`PublicThemeShell`）が持つ。ここでは中身だけを描く。
  return (
    <div className="page--narrow event-page">
      <PosterHero
        title={event.title}
        flyer={event.flyerAsset}
        stamp={!event.rsvpOpen ? "受付終了" : full ? "満員" : "受付中"}
        isFull={event.rsvpOpen && full}
      />
      <EventMetaCard event={event} />
      <div className="event-body">
        {/* 共有は主催一覧とカレンダーが持つ。告知ページには置かない。 */}
        <DynamicRsvpBox
          eventId={event.id}
          schedules={event.schedules}
          pricePlans={event.pricePlans}
          discounts={event.discounts}
          initialRsvp={event.myRsvp}
          capacity={event.capacity}
          attendingCount={event.attendingCount}
          waitlistCount={event.waitlistCount}
          closed={!event.rsvpOpen}
          closedMessage={
            event.status === "PUBLISHED"
              ? "申し込み期限を過ぎています。新しい申し込みと回答の変更はできません。取消はできます。"
              : "このイベントは出欠を受け付けていません。"
          }
          memberName={event.viewer.loggedIn ? event.viewer.name ?? event.myRsvp?.name ?? null : null}
          loginHref={`/participant/login?next=${encodeURIComponent(`/events/${event.id}`)}`}
          open={rsvpOpen}
          onOpenChange={setRsvpOpen}
          onAnsweredChange={setAnswered}
          barEntry
          onCountChange={(count) => setEvent((current) => ({ ...current, attendingCount: count }))}
          onWaitlistCountChange={(count) =>
            setEvent((current) => ({ ...current, waitlistCount: count }))
          }
        />
        <OrganizerInviteCard eventId={event.id} viewer={event.viewer} />
        {/* 履歴はログイン中の共通ヘッダーが受ける。未ログインのときだけ、戻り先を履歴にして 1 本置く。 */}
        {!event.loggedIn && (
          <p className="page-lead event-page__foot">
            <Link
              href={`/participant/login?next=${encodeURIComponent("/participant/history")}`}
              className="text-link"
            >
              参加者ログインして参加履歴を見る
            </Link>
          </p>
        )}
      </div>
      <StickyRsvpBar
        attendingCount={event.attendingCount}
        waitlistCount={event.waitlistCount}
        capacity={event.capacity}
        answered={hasAnswered}
        closed={!event.rsvpOpen}
        onOpen={() => setRsvpOpen(true)}
        organizerHref={
          event.organizers.owner?.userId ? `/organizers/${event.organizers.owner.userId}` : null
        }
        showInvite={showsOrganizerInvite(event.viewer)}
      />
    </div>
  );
}
