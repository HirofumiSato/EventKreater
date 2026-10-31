import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { PageHeader } from "@/components/ui";
import { SAMPLE_EVENTS } from "./samples";

export const metadata: Metadata = {
  title: "サンプルの告知ページ",
  description:
    "このサービスで実際に作った告知ページの見本を、催しの型ごとに並べています。チラシと出欠が 1 つのページにまとまります。",
};

/**
 * 見本の一覧（SCR-PUB-16）。
 *
 * 初見の幹事が、作る前に「自分の催しならどう見えるか」を確かめる画面である。
 * 料金の説明は `/service`、作成は主操作とこの一覧の末尾が受ける。
 * ここでは催しの型（外ごはん・マーケット・子ども連れ・アウトドア・ナイト）だけを並べる。
 */
export default function SampleIndexPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="サンプル"
        title="サンプルの告知ページ"
        lead="実際に作った告知ページです。催しの型ごとに並べています。"
      />
      <ul className="sample-list">
        {SAMPLE_EVENTS.map((event) => {
          const first = event.schedules[0];
          return (
            <li key={event.slug}>
              <Link href={`${SITE.nav.sample.href}/${event.slug}`} className="sample-card">
                <img
                  className="sample-card__flyer"
                  src={event.flyerSrc}
                  alt={`${event.title}のチラシ`}
                  width={1080}
                  height={1528}
                  loading="lazy"
                />
                <div className="sample-card__body">
                  <p className="sample-card__kind">{event.kind}</p>
                  <p className="sample-card__title">{event.title}</p>
                  <p className="sample-card__intro">{event.intro}</p>
                  {first && (
                    <p className="sample-card__meta">
                      {first.eventDate} {first.eventTime}
                    </p>
                  )}
                  <p className="sample-card__meta">{event.venueName}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="panel__actions">
        <Link href={SITE.nav.createEvent.href} className="btn btn--primary">
          {SITE.cta.createEventFree}
        </Link>
      </div>
      <p className="screen-note">
        <span aria-hidden="true">※</span>
        {SITE.cta.freeNote}
        <br />
        サンプルの催しと主催者は架空です。
      </p>
    </div>
  );
}
