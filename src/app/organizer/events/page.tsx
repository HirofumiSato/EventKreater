"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EventCard } from "@/modules/events/components/EventCard";
import { EventLifecycleModal } from "@/modules/organizers/components/EventLifecycleModal";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { Toast } from "@/components/common/Toast";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem } from "@/lib/problem";
import { phoneVerifyUrl } from "@/lib/auth-links";
import { SITE } from "@/lib/site";
import type { OrganizerEvent } from "@/modules/events/types";
import { Alert, EmptyState, Loading, PageHeader, Section, SectionHead } from "@/components/ui";


function OrganizerEventsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quotaState = useEventQuota();
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  // 下書きは専用の一覧（/organizer/events/drafts）へ分ける。出欠の統計が常に 0 のため。
  const [draftCount, setDraftCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);

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
    const data = (await res.json()) as { events: OrganizerEvent[] };
    // 一覧 API は全件を返す。マイページとカレンダーが全件前提なので、絞り込みは画面側で行う。
    setEvents(data.events.filter((event) => event.status !== "DRAFT"));
    setDraftCount(data.events.filter((event) => event.status === "DRAFT").length);
    setError(null);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  // 会員登録から戻ってきたときの完了トースト。URL からは印を消して、再読み込みで繰り返さない。
  useEffect(() => {
    if (searchParams.get("registered") !== "1") return;
    setToast("会員登録が完了しました。公開したイベントは一覧から管理できます。");
    router.replace("/organizer/events");
  }, [searchParams, router]);

  const cloneEvent = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/organizer/events/${id}/clone`, { method: "POST" });
      if (res.status === 402) {
        quotaState.openPricingModal({ returnTo: "/organizer/events" });
        return;
      }
      if (res.status === 403) {
        const problem = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (problem.error === "PHONE_REQUIRED") {
          window.location.href = phoneVerifyUrl("/organizer/events");
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

  const publishedCount = events.filter((event) => event.status === "PUBLISHED").length;
  const closedCount = events.filter((event) => event.status === "CLOSED").length;
  const attendingTotal = events.reduce((total, event) => total + event.stats.attendingCount, 0);

  return (
    <div className="stack">
      <PageHeader eyebrow="主催者" title="主催イベント一覧" lead="作ったイベントと、参加者の出欠をまとめて見られます。下書きは「下書き」に分けています。" />

      {/* 主催一覧・カレンダー・売上・プロフィールは主催者の節（org-subnav）と重ねない。 */}
      <div className="panel__actions">
        <Link href="/organizer/events/drafts" className="btn btn--outline btn--sm">
          下書き一覧{draftCount > 0 ? `（${draftCount}）` : ""}
        </Link>
        <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--sm">
          新規作成
        </Link>
      </div>

      <QuotaStatusBanner
        quota={quotaState.quota}
        onOpenPricing={() => quotaState.openPricingModal({ returnTo: "/organizer/events" })}
      />
      <VerifyPaymentBanner
        onVerified={() => {
          void quotaState.refreshQuota();
          void load();
        }}
      />

      {loading && (
        <Loading>
          読み込んでいます
        </Loading>
      )}
      {error && (
        <Alert tone="warning">
          {error}{" "}
          <Link href={SITE.nav.organizerLogin.href} className="text-link">
            {SITE.nav.organizerLogin.label}
          </Link>
        </Alert>
      )}

      {!loading && !error && (
        <div className="stat-grid">
          <div className="stat">
            <p className="stat__label">公開中</p>
            <p className="stat__value">
              {publishedCount}
              <span className="stat__unit">件</span>
            </p>
          </div>
          <div className="stat">
            <p className="stat__label">受付停止</p>
            <p className="stat__value">
              {closedCount}
              <span className="stat__unit">件</span>
            </p>
          </div>
          <div className="stat">
            <p className="stat__label">参加</p>
            <p className="stat__value">
              {attendingTotal}
              <span className="stat__unit">人</span>
            </p>
          </div>
        </div>
      )}

      <Section>
        <SectionHead title="公開中" />
        {!loading && !error && events.length === 0 && (
          <EmptyState as="div" style={{ marginTop: "1rem" }}>
            <p className="empty__title">
              {draftCount > 0 ? `公開中の催しはありません。下書きが${draftCount}件あります。` : "まだ主催イベントがありません。"}
            </p>
            {draftCount > 0 && (
              <p className="empty__body">
                内容を確かめてから公開できます。{" "}
                <Link href="/organizer/events/drafts" className="text-link">
                  下書き一覧を開く
                </Link>
              </p>
            )}
          </EmptyState>
        )}
        <div className="card-grid" style={{ marginTop: "1rem" }}>
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
      </Section>
      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quotes={quotaState.quota?.pricing ?? null}
        freeGrantRemaining={quotaState.quota?.freeGrantRemaining}
        context="list"
        onGranted={() => setToast("0円チケットを1回分受け取りました。もう一度「コピー作成」を押してください。")}
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

export default function OrganizerEventsPage() {
  return (
    <Suspense
      fallback={
        <Loading>
          読み込んでいます
        </Loading>
      }
    >
      <OrganizerEventsScreen />
    </Suspense>
  );
}
