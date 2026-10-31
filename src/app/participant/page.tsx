"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { readProblem } from "@/lib/problem";
import { rsvpStatusTone } from "@/modules/events/lib/rsvp-status";
import type { ParticipationListResponse } from "@/modules/participants/types";
import { Alert, Badge, EmptyState, Loading, PageHeader, Panel, Row, Rows, Section, SectionHead } from "@/components/ui";

interface ProfileResponse {
  user: { id: string; email: string; name: string };
  isOrganizer: boolean;
}

export default function ParticipantHomePage() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [upcoming, setUpcoming] = useState<ParticipationListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const profileRes = await fetch("/api/v1/user/profile");
      if (profileRes.status === 401) {
        if (active) setError("ログインが必要です。");
        return;
      }
      if (!profileRes.ok) {
        if (active) setError(await readProblem(profileRes));
        return;
      }
      const profileBody = (await profileRes.json()) as ProfileResponse;
      const listRes = await fetch("/api/v1/user/participations?scope=upcoming&limit=3");
      const listBody = listRes.ok ? ((await listRes.json()) as ParticipationListResponse) : null;
      if (!active) return;
      setProfile(profileBody);
      setUpcoming(listBody);
      await fetch("/api/v1/user/hydrate", { method: "POST" });
    })().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
    });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="page--narrow stack">
        <Alert tone="warning">
          {error}{" "}
          <Link href="/participant/login" className="text-link">
            参加者ログイン
          </Link>
        </Alert>
      </div>
    );
  }
  if (!profile) {
    return (
      <Loading>
        参加者ホームを読み込んでいます
      </Loading>
    );
  }

  const summary = upcoming?.summary;
  /** 直近 1 件だけを大きく（チラシ付きのカード）し、残りは行にする。 */
  const nextItem = upcoming?.items[0] ?? null;
  const restItems = upcoming?.items.slice(1) ?? [];

  return (
    <div className="stack">
      <PageHeader
        eyebrow="参加者"
        title={<>こんにちは、{profile.user.name}さん</>}
        lead={<>{profile.user.email} ・ 出欠の履歴と領収書を確認できます。</>}
      />

      {/* 数は 4 つ。モックの「次の支払い」は実装に持つ金額が無いので出さない。 */}
      <div className="roster-summary">
        <div className="roster-summary__item">
          <span className="roster-summary__label">これから</span>
          <span className="roster-summary__value">
            {summary ? summary.upcoming : "-"}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">出席</span>
          <span className="roster-summary__value">
            {summary ? summary.attending : "-"}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">欠席</span>
          <span className="roster-summary__value">
            {summary ? summary.declined : "-"}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">参加要望</span>
          <span className="roster-summary__value">
            {summary ? summary.waitlisted : "-"}
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
              {nextItem.receiptId && (
                <Link href={`/events/${nextItem.event.id}/receipt`} className="btn btn--ghost btn--sm">
                  領収書を見る
                </Link>
              )}
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

      {!upcoming || upcoming.items.length === 0 ? (
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
                      {row.pricePlanLabel ? ` ・ ${row.pricePlanLabel}` : ""} ／ {row.event.location}</>}
                  aside={<><Badge tone={rsvpStatusTone(row.status)} small>
                    {row.statusLabel}
                  </Badge></>}
                  key={row.id}
                >
                  <p className="rows__meta">
                      <Link href={`/events/${row.event.id}`} className="text-link">
                        出欠を変更
                      </Link>
                      {row.receiptId && (
                        <>
                          {" ・ "}
                          <Link href={`/events/${row.event.id}/receipt`} className="text-link">
                            領収書を見る
                          </Link>
                        </>
                      )}
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
