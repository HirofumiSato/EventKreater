import type { Metadata } from "next";
import Link from "next/link";
import { formatDateWithWeekdayJa } from "@/lib/format";
import { SITE } from "@/lib/site";
import { PageHeader, Section, SectionHead } from "@/components/ui";
import { profileInitial } from "@/modules/organizers/lib/profile";
import { SAMPLE_PROFILES } from "./profiles";
import { SAMPLE_EVENTS } from "./samples";

export const metadata: Metadata = {
  title: "サンプルのページ",
  description:
    "このサービスで実際に作った告知ページと、主催者のプロフィールの見本を並べています。チラシと出欠が 1 つのページにまとまります。",
};

/**
 * 見本の一覧（SCR-PUB-16）。
 *
 * 初見の幹事が、作る前に「自分の催しならどう見えるか」を確かめる画面である。
 * 料金の説明は `/service`、作成は主操作とこの一覧の末尾が受ける。
 * 催しの型（外ごはん・マーケット・子ども連れ・アウトドア・ナイト）と、
 * 主催者の型（個人・演者・店）を並べる。プロフィールの詳細は `/sample/profile/[slug]`。
 */
export default function SampleIndexPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="サンプル"
        title="サンプルのページ"
        lead="実際に作ったページの見本です。催しと主催者の型ごとに並べています。"
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
                      {formatDateWithWeekdayJa(first.eventDate)} {first.eventTime}
                    </p>
                  )}
                  <p className="sample-card__meta">{event.venueName}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <Section id="sample-profiles">
        <SectionHead title="主催者のプロフィール" note="公開したときに、参加者の目に映る姿です。" />
        <ul className="sample-list">
          {SAMPLE_PROFILES.map((profile) => (
            <li key={profile.slug}>
              <Link
                href={`${SITE.nav.sample.href}/profile/${profile.slug}`}
                className="sample-card"
              >
                <span className="sample-card__avatar" aria-hidden="true">
                  {profileInitial(profile.name)}
                </span>
                <div className="sample-card__body">
                  <p className="sample-card__kind">{profile.kind}</p>
                  <p className="sample-card__title">{profile.name}</p>
                  {profile.profile.headline && (
                    <p className="sample-card__intro">{profile.profile.headline}</p>
                  )}
                  {profile.profile.area && (
                    <p className="sample-card__meta">{profile.profile.area}</p>
                  )}
                  {profile.profile.stats && (
                    <p className="sample-card__meta">
                      これまで {profile.profile.stats.eventCount}回 ／{" "}
                      {profile.profile.stats.sinceYear}年から
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

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
