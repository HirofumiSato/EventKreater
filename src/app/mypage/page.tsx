"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { NotificationList } from "@/modules/notifications/components/NotificationList";
import { announceNotificationsChanged } from "@/modules/notifications/hooks/useNotifications";
import type { NotificationsResponse, RsvpNotification } from "@/modules/notifications/types";
import { readProblem } from "@/lib/problem";
import { loginUrl } from "@/lib/auth-links";
import { SITE } from "@/lib/site";
import { priceLabel, scheduleLabel } from "@/lib/serializers";
import type { OrganizerEvent } from "@/modules/events/types";
import { todayInTokyo } from "@/modules/events/lib/event-filters";
import { countPublishedBySource } from "@/modules/events/lib/published-counts";
import type { OrganizerProfileDraftResponse } from "@/modules/organizers/types";
import { Alert, EmptyState, Loading, PageHeader, Row, Rows, Section, SectionHead } from "@/components/ui";

/** ホームに出す主催イベントの件数。全件は主催一覧（SCR-ORG-01）が持つ。 */
const SUMMARY_LIMIT = 3;

interface ProfileResponse {
  user: { id: string; email: string; name: string };
  isOrganizer: boolean;
}

/**
 * 主催者（幹事）のマイページ。
 * 参加履歴はここへ混ぜず、参加者ホーム（/participant）と参加履歴（/participant/history）に分ける。
 */
export default function MyPage() {
  const quotaState = useEventQuota();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [ownProfile, setOwnProfile] = useState<OrganizerProfileDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 新着（参加表明・参加要望）。主催者だけが持つ。
  const [notifications, setNotifications] = useState<RsvpNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
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
      const eventsRes = await fetch("/api/v1/organizer/events");
      const eventsBody = eventsRes.ok ? ((await eventsRes.json()) as { events: OrganizerEvent[] }) : { events: [] };
      // 主催者だけが公開プロフィールを持つ。まだイベントが無い会員は 403 なので、その場合は節を出さない。
      const ownRes = profileBody.isOrganizer ? await fetch("/api/v1/organizer/profile") : null;
      const ownBody = ownRes?.ok ? ((await ownRes.json()) as OrganizerProfileDraftResponse) : null;
      // 新着は主催者だけが持つ。参加者の端末では問い合わせない。
      const notificationsBody = profileBody.isOrganizer
        ? await fetch("/api/v1/notifications?limit=5").then(async (res) =>
            res.ok ? ((await res.json()) as NotificationsResponse) : null,
          )
        : null;
      if (!active) return;
      setProfile(profileBody);
      // 下書きは出欠の統計を持たないため、要約には公開済みと受付停止だけを出す。
      // 下書きの管理は主催一覧の「下書き一覧」が受け持つ。
      setEvents(eventsBody.events.filter((event) => event.status !== "DRAFT"));
      setOwnProfile(ownBody);
      if (notificationsBody) {
        setNotifications(notificationsBody.notifications);
        setUnreadCount(notificationsBody.unreadCount);
      }
      await fetch("/api/v1/user/hydrate", { method: "POST" });
    };
    void load().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
    });
    return () => {
      active = false;
    };
  }, []);

  const logout = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  /** 既読の送信。応答の未読数をそのまま反映し、ヘッダーのバッジにも知らせる。 */
  const markRead = async (ids?: string[]) => {
    if (marking) return;
    setMarking(true);
    const readAt = new Date().toISOString();
    try {
      const res = await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids && ids.length > 0 ? { ids } : { all: true }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { unreadCount: number };
      setUnreadCount(body.unreadCount);
      // 楽観的にはせず、送れた分だけ既読にする（失敗したら未読のまま残す）。
      const target = ids && ids.length > 0 ? new Set(ids) : null;
      setNotifications((current) =>
        current.map((row) =>
          !target || target.has(row.id) ? { ...row, readAt: row.readAt ?? readAt } : row,
        ),
      );
      announceNotificationsChanged();
    } catch {
      // 既読にできなかっただけ。未読のまま残し、次の読み込みで取り直す。
    } finally {
      setMarking(false);
    }
  };

  /** 行を押したとき。名簿へ移る前に、その 1 件だけ既読にする。 */
  const openNotification = (notification: RsvpNotification) => {
    if (notification.readAt !== null) return;
    void markRead([notification.id]);
  };

  if (error) {
    return (
      <Alert tone="warning">
        {error}{" "}
        <Link href={loginUrl("/mypage")} className="text-link">
          主催者ログイン
        </Link>
      </Alert>
    );
  }
  if (!profile) {
    return (
      <Loading>
        マイページを読み込んでいます
      </Loading>
    );
  }

  // 要約は帯と同じ数え方にする。公開済み・開催日が今日以降・自分の筆頭幹事のものだけを、
  // 月額プラン（上限に数える）とチケット（単発・無料枠。上限の外）に分ける。
  // 参加の人数は出さない。直近のイベントの行と名簿が持ち、ここに置くと二重になる。
  const publishedCounts = countPublishedBySource(events, todayInTokyo());

  return (
    <div className="stack">
      <PageHeader
        title="主催者マイページ"
        lead={<>{profile.user.name} さん。イベントは {events.length}件です。</>}
      />

      <div className="roster-summary roster-summary--pairs">
        <div className="roster-summary__item roster-summary__item--plan">
          <span className="roster-summary__label">プラン公開</span>
          <span className="roster-summary__value">
            {publishedCounts.plan}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item roster-summary__item--ticket">
          <span className="roster-summary__label">チケット公開</span>
          <span className="roster-summary__value">
            {publishedCounts.ticket}
            <span>件</span>
          </span>
        </div>
      </div>

      <QuotaStatusBanner
        quota={quotaState.quota}
        onOpenPricing={() => quotaState.openPricingModal({ returnTo: "/mypage" })}
      />
      <VerifyPaymentBanner onVerified={() => void quotaState.refreshQuota()} />

      {/* 新着は数字のすぐ下に置く。契約やイベントより先に、誰かが答えたことが目に入る。
          マイページは 4 件までにし、続きは通知一覧（/notifications）が受ける。 */}
      {profile.isOrganizer && (
        <NotificationList
          notifications={notifications}
          unreadCount={unreadCount}
          marking={marking}
          onMarkAll={() => void markRead()}
          onMarkOne={(notification) => void markRead([notification.id])}
          onOpen={openNotification}
          moreHref={SITE.nav.notifications.href}
        />
      )}

      <Section>
        <SectionHead title="直近のイベント" note={<>{SUMMARY_LIMIT}件まで。続きは主催一覧で。</>} />
        {events.length === 0 && (
          <EmptyState>
            まだ主催イベントはありません。{" "}
            <Link href={SITE.nav.createEvent.href} className="text-link">
              {SITE.cta.createEventFirst}
            </Link>
          </EmptyState>
        )}
        {events.length > 0 && (
          <Rows>
            {events.slice(0, SUMMARY_LIMIT).map((event) => (
              <Row
                title={<>{event.title}</>}
                meta={<>{scheduleLabel(event.schedules)} ／ 参加 {event.stats.attendingCount}名
                    {event.capacity === null ? " ／ 定員なし" : ` / ${event.capacity}名`} ／{" "}
                    {priceLabel(event.pricePlans)}</>}
                aside={<><div className="event-card__actions">
                  <Link
                    href={`/organizer/events/${event.id}/participants`}
                    className="btn btn--ghost btn--sm"
                  >
                    名簿
                  </Link>
                  <Link
                    href={`/organizer/events/${event.id}/edit`}
                    className="btn btn--ghost btn--sm"
                  >
                    編集
                  </Link>
                </div></>}
                key={event.id}
              />
            ))}
          </Rows>
        )}
        <div className="panel__actions">
          <Link href="/organizer/events" className="btn btn--outline btn--sm">
            すべて見る
          </Link>
          <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--sm">
            {SITE.nav.createEvent.label}
          </Link>
        </div>
      </Section>

      {ownProfile && (
        <Section>
          <SectionHead title="公開プロフィール" />
          <dl className="kv">
            <div className="kv__row">
              <dt>状態</dt>
              <dd>{ownProfile.profile.isPublished ? "公開中" : "非公開"}</dd>
            </div>
            <div className="kv__row">
              <dt>見えている内容</dt>
              <dd>肩書き、自己紹介、活動エリア、ジャンル、リンク</dd>
            </div>
          </dl>
          <div className="panel__actions">
            <Link href="/organizer/profile" className="btn btn--primary btn--sm">
              編集する
            </Link>
            <a
              href={ownProfile.homePath}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--outline btn--sm"
            >
              公開ページを見る
            </a>
          </div>
        </Section>
      )}

      <Section>
        <SectionHead title="アカウント" note={<>{profile.user.email}</>} />
        <div className="panel__actions">
          <Link href="/account" className="btn btn--outline btn--sm">
            アカウント設定
          </Link>
          <Link href={SITE.nav.participantSwitch.href} className="btn btn--outline btn--sm">
            {SITE.nav.participantSwitch.label}
          </Link>
          <button type="button" onClick={() => void logout()} className="btn btn--ghost btn--sm">
            ログアウト
          </button>
        </div>
      </Section>

      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quotes={quotaState.quota?.pricing ?? null}
        freeGrantRemaining={quotaState.quota?.freeGrantRemaining}
        currentPlan={quotaState.quota?.subscriptionPlan}
        context="mypage"
        onGranted={() => void quotaState.refreshQuota()}
      />
    </div>
  );
}
