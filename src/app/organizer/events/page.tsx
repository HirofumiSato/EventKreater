"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EventCard } from "@/modules/events/components/EventCard";
import { EventLifecycleModal } from "@/modules/organizers/components/EventLifecycleModal";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import { OrganizerPagePreviewModal } from "@/modules/organizers/components/OrganizerPagePreviewModal";
import { organizerProfilePath } from "@/modules/organizers/lib/public-page";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { StripePortalButton } from "@/modules/billing/components/StripePortalButton";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { Toast } from "@/components/common/Toast";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem } from "@/lib/problem";
import { SITE } from "@/lib/site";
import type { OrganizerEvent } from "@/modules/events/types";

export default function OrganizerEventsPage() {
  const router = useRouter();
  const quotaState = useEventQuota();
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ userId: string | null; name: string | null } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/organizer/events");
    if (res.status === 401) {
      setError("ログインするか、幹事トークン付きの端末で開いてください。");
      setEvents([]);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      return;
    }
    const data = (await res.json()) as {
      events: OrganizerEvent[];
      viewer?: { userId: string | null; name: string | null };
    };
    setEvents(data.events);
    setViewer(data.viewer ?? null);
    setError(null);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const cloneEvent = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/organizer/events/${id}/clone`, { method: "POST" });
      if (res.status === 402) {
        quotaState.openPricingModal();
        return;
      }
      if (res.status === 403) {
        const problem = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (problem.error === "PHONE_REQUIRED") {
          window.location.href = "/auth/register?step=phone&next=/organizer/events";
          return;
        }
        throw new Error(problem.detail || "複製に失敗しました");
      }
      if (!res.ok) throw new Error(await readProblem(res));
      const data = (await res.json()) as { event: { id: string } };
      router.push(`/organizer/events/${data.event.id}/edit`);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "複製に失敗しました");
    } finally {
      setBusyId(null);
      void quotaState.refreshQuota();
    }
  };

  const copyPublicPageUrl = async () => {
    if (!viewer?.userId) return;
    await navigator.clipboard.writeText(`${window.location.origin}${organizerProfilePath(viewer.userId)}`);
    setToast("公開ページのURLをコピーしました。参加者に配れます。");
  };

  const runLifecycle = async (id: string, action: "close" | "delete") => {    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/organizer/events/${id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      setToast(action === "delete" ? "イベントを削除しました" : "出欠受付を停止しました");
      setManagingId(null);
      await load();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "操作に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="stack">
      <OrganizerTabs />
      <section className="panel">
        <div>
          <h1 className="page-title">主催イベント一覧</h1>
          <p className="page-lead">出欠の集計、編集、複製、プラン管理をここから行います。</p>
        </div>
        <div className="panel__actions">
          {viewer?.userId && (
            <>
              <Link
                href={organizerProfilePath(viewer.userId)}
                target="_blank"
                rel="noreferrer"
                className="btn btn--outline"
              >
                公開ページ
              </Link>
              <button type="button" className="btn btn--outline" onClick={() => void copyPublicPageUrl()}>
                URLをコピー
              </button>
              <button type="button" className="btn btn--outline" onClick={() => setPreviewOpen(true)}>
                プレビュー
              </button>
            </>
          )}
          <StripePortalButton />
          <Link href="/organizer/revenue" className="btn btn--outline">
            売上を見る
          </Link>
          <Link href="/organizer/events/new" className="btn btn--primary">
            新規作成
          </Link>
        </div>
      </section>
      <QuotaStatusBanner quota={quotaState.quota} onOpenPricing={quotaState.openPricingModal} />
      {loading && (
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          読み込んでいます
        </p>
      )}
      {error && (
        <p className="alert alert--warning">
          {error}{" "}
          <Link href={SITE.nav.organizerLogin.href} className="text-link">
            {SITE.nav.organizerLogin.label}
          </Link>
        </p>
      )}
      {!loading && !error && events.length === 0 && <p className="empty">まだ主催イベントがありません。</p>}
      <div className="stack">
        {events.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            busy={busyId === event.id}
            onClone={() => void cloneEvent(event.id)}
            onDelete={() => setManagingId(event.id)}
          />
        ))}
      </div>
      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quotes={quotaState.quota?.pricing ?? null}
        freeGrantRemaining={quotaState.quota?.freeGrantRemaining}
        onGranted={() => setToast("0円チケットを1回分受け取りました。")}
      />
      {managingId && (
        <EventLifecycleModal
          title={events.find((event) => event.id === managingId)?.title ?? "イベント"}
          status={events.find((event) => event.id === managingId)?.status ?? "PUBLISHED"}
          busy={busyId === managingId}
          onClose={() => setManagingId(null)}
          onStop={() => void runLifecycle(managingId, "close")}
          onDelete={() => void runLifecycle(managingId, "delete")}
        />
      )}
      {previewOpen && viewer?.userId && (
        <OrganizerPagePreviewModal
          userId={viewer.userId}
          organizerName={viewer.name ?? "主催者"}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      {toast && (
        <Toast
          message={toast}
          tone={toast.includes("失敗") ? "error" : "success"}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
