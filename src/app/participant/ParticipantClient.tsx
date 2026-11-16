"use client";

import { useEffect } from "react";
import Link from "next/link";
import { rsvpStatusTone } from "@/modules/events/lib/rsvp-status";
import type { ParticipantHomePayload } from "@/modules/participants/lib/home";
import { Badge, EmptyState, PageHeader, Panel, Row, Rows, Section, SectionHead } from "@/components/ui";

/**
 * 参加者ホーム（SCR-PUB-02）。
 *
 * 呼びかけ・要約・直近 3 件はサーバーで読んで渡す。ここは端末だけの出欠を会員へ
 * 引き継ぐときだけサーバーを呼ぶ（初回の取り直しはしない）。
 */
export function ParticipantHomeScreen({
  initial,
  needsHydrate,
}: {
  initial: ParticipantHomePayload;
  /** 端末だけの出欠・幹事が残っている端末だけ true（`/api/v1/user/profile` と同じ判定）。 */
  needsHydrate: boolean;
}) {
  const { profile, upcoming } = initial;

  // 端末だけの出欠を会員へ引き継ぐ。結果はこの画面に出さないので待たない。
  useEffect(() => {
    if (!needsHydrate) return;
    void fetch("/api/v1/user/hydrate", { method: "POST" }).catch(() => {});
  }, [needsHydrate]);

  const summary = upcoming.summary;
  /** 直近 1 件だけを大きく（チラシ付きのカード）し、残りは行にする。 */
  const nextItem = upcoming.items[0] ?? null;
  const restItems = upcoming.items.slice(1);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="参加者"
        title={<>こんにちは、{profile.name}さん</>}
        lead={<>{profile.email} ・ 出欠の履歴を確認できます。</>}
      />

      {/* 数は 4 つ。モックの「次の支払い」は実装に持つ金額が無いので出さない。 */}
      <div className="roster-summary">
        <div className="roster-summary__item">
          <span className="roster-summary__label">これから</span>
          <span className="roster-summary__value">
            {summary.upcoming}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">出席</span>
          <span className="roster-summary__value">
            {summary.attending}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">欠席</span>
          <span className="roster-summary__value">
            {summary.declined}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">参加要望</span>
          <span className="roster-summary__value">
            {summary.waitlisted}
            <span>件</span>
          </span>
        </div>
      </div>

      {nextItem && (
        <Section style={{ marginTop: 0 }}>
          <SectionHead title="次のイベント" note="いちばん近いものです。" />
          <article
            className={`event-card${nextItem.event.flyerThumbnailUrl ? "" : " event-card--no-thumb"}`}
            style={{ marginTop: "0.875rem" }}
          >
            {nextItem.event.flyerThumbnailUrl ? (
              <img
                className="event-card__thumb"
                src={nextItem.event.flyerThumbnailUrl}
                alt=""
                width={1080}
                height={1920}
              />
            ) : null}
            <div>
              <div className="event-card__head">
                <h3 className="event-card__title">
                  <Link href={`/events/${nextItem.event.id}`}>{nextItem.event.title}</Link>
                </h3>
                <Badge tone={rsvpStatusTone(nextItem.status)} small>
                  {nextItem.statusLabel}
                </Badge>
              </div>
              <p className="event-card__meta">
                {nextItem.scheduleLabel ?? nextItem.event.sortDate}
                {nextItem.pricePlanLabel ? ` ・ ${nextItem.pricePlanLabel}` : ""}
                {nextItem.discountLabel ? ` ・ ${nextItem.discountLabel}` : ""}
                <br />
                {nextItem.event.location}
              </p>
              {nextItem.comment && <p className="event-card__meta">コメント: {nextItem.comment}</p>}
              <div className="event-card__meter-label">
                <span>回答済み</span>
                <span>
                  {new Intl.DateTimeFormat("ja-JP", {
                    timeZone: "Asia/Tokyo",
                    month: "numeric",
                    day: "numeric",
                  }).format(new Date(nextItem.answeredAt))}
                  に回答
                </span>
              </div>
            </div>
            <div className="card__actions" style={{ marginTop: 0 }}>
              <Link href={`/events/${nextItem.event.id}`} className="btn btn--outline btn--sm">
                開く
              </Link>
              {nextItem.event.ownerUserId && (
                <Link
                  href={`/organizers/${nextItem.event.ownerUserId}`}
                  className="btn btn--ghost btn--sm"
                >
                  主催者のページ
                </Link>
              )}
            </div>
          </article>
        </Section>
      )}

      {upcoming.items.length === 0 ? (
        <Section>
          <SectionHead title="これからの参加" note="日付の近い順です。回答はあとから変えられます。" />
          <EmptyState>
            <span className="empty__title">これから参加するイベントはありません。</span>
            <span className="empty__body">主催者から届いた告知URLを開くと、出欠を答えられます。</span>
          </EmptyState>
        </Section>
      ) : (
        restItems.length > 0 && (
          <Section>
            <SectionHead title="これからの参加" note="日付の近い順です。回答はあとから変えられます。" />
            <Rows>
              {restItems.map((row) => (
                <Row
                  title={<><Link href={`/events/${row.event.id}`}>{row.event.title}</Link></>}
                  meta={<>{row.scheduleLabel ?? row.event.sortDate}
                      {row.pricePlanLabel ? ` ・ ${row.pricePlanLabel}` : ""}
                      {row.discountLabel ? ` ・ ${row.discountLabel}` : ""} ／ {row.event.location}</>}
                  aside={<><Badge tone={rsvpStatusTone(row.status)} small>
                    {row.statusLabel}
                  </Badge></>}
                  key={row.id}
                >
                  <p className="rows__meta">
                      <Link href={`/events/${row.event.id}`} className="text-link">
                        出欠を変更
                      </Link>
                      {row.event.ownerUserId && (
                        <>
                          {" ・ "}
                          <Link href={`/organizers/${row.event.ownerUserId}`} className="text-link">
                            主催者のページ
                          </Link>
                        </>
                      )}
                    </p>
                </Row>
              ))}
            </Rows>
          </Section>
        )
      )}

      <div className="panel__actions">
        <Link href="/participant/calendar" className="btn btn--outline btn--sm">
          カレンダーで見る
        </Link>
        <Link href="/participant/history" className="btn btn--ghost btn--sm">
          参加履歴をすべて見る
        </Link>
      </div>

      <Section>
        <SectionHead title="主催する側でも使う" note="同じアカウントで、イベントを開けます。" />
        <Panel as="div">
          <p className="panel__title">主催者マイページ</p>
          <p className="panel__note">作ったイベント、出欠の集計、売上をまとめて見られます。</p>
          <div className="panel__actions">
            <Link href="/mypage" className="btn btn--primary btn--sm">
              主催者として使う
            </Link>
          </div>
        </Panel>
      </Section>

      <p className="screen-note">
        参加するだけならログインは要りません。履歴を残したいときだけ、この画面のアカウントでログインしてください。
      </p>
    </div>
  );
}
