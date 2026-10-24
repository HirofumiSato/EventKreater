"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { StripePortalButton } from "@/modules/billing/components/StripePortalButton";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem } from "@/lib/problem";
import { loginUrl } from "@/lib/auth-links";
import { SITE } from "@/lib/site";
import { priceLabel, scheduleLabel } from "@/lib/serializers";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import type { OrganizerEvent } from "@/modules/events/types";
import type { OrganizerProfileDraftResponse } from "@/modules/organizers/types";
import { Alert, EmptyState, Loading, PageHeader, Panel, Row, Rows, Section, SectionHead } from "@/components/ui";

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
      // 主催者だけが公開プロフィールを持つ。まだ催しが無い会員は 403 なので、その場合は節を出さない。
      const ownRes = profileBody.isOrganizer ? await fetch("/api/v1/organizer/profile") : null;
      const ownBody = ownRes?.ok ? ((await ownRes.json()) as OrganizerProfileDraftResponse) : null;
      if (!active) return;
      setProfile(profileBody);
      // 下書きは出欠の統計を持たないため、要約には公開済みと受付停止だけを出す。
      // 下書きの管理は主催一覧の「下書き一覧」が受け持つ。
      setEvents(eventsBody.events.filter((event) => event.status !== "DRAFT"));
      setOwnProfile(ownBody);
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

  const publishedCount = events.filter((event) => event.status === "PUBLISHED").length;
  const closedCount = events.filter((event) => event.status === "CLOSED").length;
  const attendingTotal = events.reduce((sum, event) => sum + event.stats.attendingCount, 0);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="主催者"
        title="主催者マイページ"
        lead={<>{profile.user.name} さん。催しは {events.length}件、公開中 {publishedCount}件です。
        </>}
      />

      <OrganizerTabs />

      <div className="roster-summary">
        <div className="roster-summary__item">
          <span className="roster-summary__label">公開中</span>
          <span className="roster-summary__value">
            {publishedCount}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">受付停止</span>
          <span className="roster-summary__value">
            {closedCount}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item roster-summary__item--money">
          <span className="roster-summary__label">参加</span>
          <span className="roster-summary__value">
            {attendingTotal}
            <span>人</span>
          </span>
        </div>
      </div>

      <QuotaStatusBanner
        quota={quotaState.quota}
        onOpenPricing={() => quotaState.openPricingModal({ returnTo: "/mypage" })}
      />
      <VerifyPaymentBanner onVerified={() => void quotaState.refreshQuota()} />

      <Section>
        <SectionHead title="直近の催し" note={<>{SUMMARY_LIMIT}件まで。すべては主催一覧で見られます。
          </>} />
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

      <Section>
        <SectionHead title="利用枠と契約" note="筆頭幹事だけが契約を変えられます。" />
        <Panel as="div">
          <div className="panel__actions">
            <StripePortalButton />
            <Link href="/service#pricing" className="btn btn--ghost btn--sm">
              料金を見る
            </Link>
          </div>
        </Panel>
      </Section>

      {ownProfile && (
        <Section>
          <SectionHead title="公開プロフィール" note="参加者が、主催者の人柄を見られる場所です。" />
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
          <Link href="/participant" className="btn btn--outline btn--sm">
            参加者として見る
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
        context="mypage"
        onGranted={() => void quotaState.refreshQuota()}
      />
    </div>
  );
}
