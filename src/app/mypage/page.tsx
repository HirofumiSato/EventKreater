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
import { priceLabel, scheduleLabel } from "@/lib/serializers";
import type { OrganizerEvent } from "@/modules/events/types";
import type { OrganizerProfileDraftResponse } from "@/modules/organizers/types";

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
      setEvents(eventsBody.events);
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
      <p className="alert alert--warning">
        {error}{" "}
        <Link href={loginUrl("/mypage")} className="text-link">
          主催者ログイン
        </Link>
      </p>
    );
  }
  if (!profile) {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        マイページを読み込んでいます
      </p>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div>
          <h1 className="page-title">{profile.user.name} のマイページ</h1>
          <p className="page-lead">{profile.user.email} ・ 幹事として主催するイベントを管理します。</p>
        </div>
        <div className="panel__actions">
          <StripePortalButton />
          <button type="button" onClick={() => void logout()} className="btn btn--ghost">
            ログアウト
          </button>
        </div>
      </section>

      <QuotaStatusBanner
        quota={quotaState.quota}
        onOpenPricing={() => quotaState.openPricingModal({ returnTo: "/mypage" })}
      />
      <VerifyPaymentBanner onVerified={() => void quotaState.refreshQuota()} />

      {ownProfile && (
        <section className="panel">
          <div>
            <p className="eyebrow">公開プロフィール</p>
            <h2 className="panel__title">{ownProfile.profile.isPublished ? "公開中" : "非公開"}</h2>
            <p className="panel__note">
              参加者が告知ページの主催者名から開くページです。自己紹介とリンクを書くと、初めて参加する人が申し込みやすくなります。
            </p>
          </div>
          <div className="panel__actions">
            <Link href="/organizer/profile" className="btn btn--outline btn--sm">
              プロフィールを編集
            </Link>
            <a
              href={ownProfile.homePath}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--outline btn--sm"
            >
              公開ページを開く
            </a>
          </div>
        </section>
      )}

      <section className="stack">
        <div className="panel">
          <div>
            <h2 className="panel__title">主催イベント</h2>
            <p className="panel__note">
              直近の{SUMMARY_LIMIT}件を表示しています。全件の管理は主催イベント一覧で行います。
            </p>
          </div>
          <div className="panel__actions">
            <Link href="/organizer/events" className="btn btn--outline btn--sm">
              すべて見る
            </Link>
            <Link href="/organizer/events/new" className="btn btn--primary btn--sm">
              イベントを作る
            </Link>
          </div>
        </div>
        {events.length === 0 && (
          <p className="empty">
            まだ主催イベントはありません。{" "}
            <Link href="/organizer/events/new" className="text-link">
              最初のイベントを作る
            </Link>
          </p>
        )}
        {events.slice(0, SUMMARY_LIMIT).map((event) => (
          <article key={event.id} className="card">
            <Link href={`/organizer/events/${event.id}/edit`} className="card__title">
              {event.title}
            </Link>
            <p className="card__body">
              {scheduleLabel(event.schedules)} · {priceLabel(event.pricePlans)} · 参加 {event.stats.attendingCount}名
            </p>
          </article>
        ))}
        {events.length > SUMMARY_LIMIT && (
          <Link href="/organizer/events" className="btn btn--ghost btn--block">
            残り{events.length - SUMMARY_LIMIT}件を主催イベント一覧で見る
          </Link>
        )}
      </section>

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
