"use client";

import Link from "next/link";
import { PosterHero } from "@/modules/events/components/PosterHero";
import { EventMetaCard } from "@/modules/events/components/EventMetaCard";
import { DynamicRsvpBox } from "@/modules/attendance/components/DynamicRsvpBox";
import { SITE } from "@/lib/site";
import { SemanticThemeScope } from "@/components/ui";
import type { SampleEvent } from "./samples";

/**
 * 見本の告知ページ。SCR-PUB-01（`/events/[id]`）と同じ部品を、同じ順に並べる。
 *
 * 本物と取り違えないよう、出欠フォームは `preview` で描き、入力も送信もできない。
 * 本物との違いは帯（`SampleBand`）と、フォームの上の 1 行だけに留める。
 * 見本ごとにテーマ（`themeId`）を変え、紙面の色と書体がどう変わるかも確かめられる。
 */
export function SampleEventView({ event }: { event: SampleEvent }) {
  return (
    <SemanticThemeScope themeId={event.themeId} page>
      <div className="page--narrow event-page">
        <PosterHero
          title={event.title}
          flyer={{
            id: `sample-${event.slug}`,
            imageUrl: event.flyerSrc,
            lqipDataUrl: null,
            aspectRatio: "9:16",
          }}
          stamp="受付中"
        />
        <EventMetaCard event={{ ...event, status: "PUBLISHED", rsvpDeadline: null, rsvpOpen: true }} />
        <div className="event-body">
          <div className="preview-rsvp">
            <p className="preview-rsvp__note">
              見本のため送信できません。実際のページでは、ここから出欠を答えられます。
            </p>
            <DynamicRsvpBox
              eventId={`sample-${event.slug}`}
              schedules={event.schedules}
              pricePlans={event.pricePlans}
              discounts={event.discounts}
              initialRsvp={null}
              capacity={event.capacity}
              attendingCount={event.attendingCount}
              waitlistCount={event.waitlistCount}
              closed={false}
              preview
              onCountChange={() => {}}
            />
          </div>
          <p className="page-lead event-page__foot">
            <Link href={SITE.nav.sample.href} className="text-link">
              ほかのサンプルを見る
            </Link>
          </p>
        </div>
      </div>
    </SemanticThemeScope>
  );
}
