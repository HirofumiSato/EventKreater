"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { StripePortalButton } from "@/modules/billing/components/StripePortalButton";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem } from "@/lib/problem";
import { priceLabel, scheduleLabel } from "@/lib/serializers";
import type { OrganizerEvent } from "@/modules/events/types";

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
      if (!active) return;
      setProfile(profileBody);
      setEvents(eventsBody.events);
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
        <Link href="/auth/register" className="text-link">
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

      <QuotaStatusBanner quota={quotaState.quota} onOpenPricing={quotaState.openPricingModal} />

      <section className="stack">
        <div className="panel">
          <h2 className="panel__title">主催イベント</h2>
          <div>
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
        {events.map((event) => (
          <article key={event.id} className="card">
            <Link href={`/organizer/events/${event.id}/edit`} className="card__title">
              {event.title}
            </Link>
            <p className="card__body">
              {scheduleLabel(event.schedules)} · {priceLabel(event.pricePlans)} · 参加 {event.stats.attendingCount}名
            </p>
          </article>
        ))}
      </section>

      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quotes={quotaState.quota?.pricing ?? null}
        freeGrantRemaining={quotaState.quota?.freeGrantRemaining}
        onGranted={() => void quotaState.refreshQuota()}
      />
    </div>
  );
}
