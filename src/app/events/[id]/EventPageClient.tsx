"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PosterHero } from "@/modules/events/components/PosterHero";
import { EventMetaCard } from "@/modules/events/components/EventMetaCard";
import { DynamicRsvpBox } from "@/modules/attendance/components/DynamicRsvpBox";
import { StickyRsvpBar } from "@/modules/attendance/components/StickyRsvpBar";
import { OrganizerInviteCard } from "@/modules/events/components/OrganizerInviteCard";
import { showsOrganizerInvite } from "@/modules/events/lib/organizer-invite";
import { LineShareButton } from "@/modules/organizers/components/LineShareButton";
import { readProblem } from "@/lib/problem";
import type { PublicEvent } from "@/modules/events/types";
import { Alert, Loading, SemanticThemeScope } from "@/components/ui";

export default function PublicEventPage({ params }: { params: { id: string } }) {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/public/events/${params.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readProblem(res));
        return (await res.json()) as PublicEvent;
      })
      .then((data) => {
        if (active) setEvent(data);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
      });
    return () => {
      active = false;
    };
  }, [params.id]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!event) {
    return (
      <Loading>
        イベントを読み込んでいます
      </Loading>
    );
  }

  const full = event.capacity !== null && event.attendingCount >= event.capacity;

  return (
    // テーマ未選択なら何も包まない。既存イベントの DOM と見た目を変えない。
    <SemanticThemeScope themeId={event.themeId} page>
      <div className="page--narrow event-page">
        <PosterHero
        title={event.title}
        flyer={event.flyerAsset}
        stamp={!event.rsvpOpen ? "受付終了" : full ? "満員" : "受付中"}
        isFull={event.rsvpOpen && full}
      />
      <EventMetaCard event={event} />
      <div className="event-body">
        <LineShareButton
          title={event.title}
          schedules={event.schedules}
          location={event.location}
          path={`/events/${event.id}`}
          className="btn btn--outline btn--block"
        />
        <DynamicRsvpBox
          eventId={event.id}
          schedules={event.schedules}
          pricePlans={event.pricePlans}
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
          onCountChange={(count) => setEvent((current) => (current ? { ...current, attendingCount: count } : current))}
          onWaitlistCountChange={(count) =>
            setEvent((current) => (current ? { ...current, waitlistCount: count } : current))
          }
        />
        <OrganizerInviteCard eventId={event.id} viewer={event.viewer} />
        {event.myReceipt && (
          <p className="page-lead event-page__foot">
            <Link href={`/events/${event.id}/receipt`} className="text-link">
              領収書を見る
            </Link>
          </p>
        )}
        <p className="page-lead event-page__foot">
          {event.loggedIn ? (
            <Link href="/participant/history" className="text-link">
              自分の参加履歴を見る
            </Link>
          ) : (
            <Link href={`/participant/login?next=${encodeURIComponent(`/events/${event.id}`)}`} className="text-link">
              会員登録して履歴を保存
            </Link>
          )}
        </p>
      </div>
      <StickyRsvpBar
        attendingCount={event.attendingCount}
        waitlistCount={event.waitlistCount}
        capacity={event.capacity}
        answered={Boolean(event.myRsvp)}
        closed={!event.rsvpOpen}
        organizerHref={
          event.organizers.owner?.userId ? `/organizers/${event.organizers.owner.userId}` : null
        }
        showInvite={showsOrganizerInvite(event.viewer)}
      />
      </div>
    </SemanticThemeScope>
  );
}
