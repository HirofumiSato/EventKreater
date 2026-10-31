"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PosterHero } from "@/modules/events/components/PosterHero";
import { EventMetaCard } from "@/modules/events/components/EventMetaCard";
import { DynamicRsvpBox } from "@/modules/attendance/components/DynamicRsvpBox";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { Toast } from "@/components/common/Toast";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem } from "@/lib/problem";
import { phoneVerifyUrl } from "@/lib/auth-links";
import { flyerPdfDownloadHref } from "@/modules/flyers/lib/pdf-link";
import type {
  EventDiscountOption,
  EventOrganizerList,
  EventPricePlanOption,
  EventScheduleOption,
  EventStatus,
  FlyerAsset,
  OrganizerRole,
  RainPolicy,
} from "@/modules/events/types";
import { Alert, Loading, SemanticThemeScope } from "@/components/ui";

interface PreviewResponse {
  event: {
    id: string;
    title: string;
    schedules: EventScheduleOption[];
    pricePlans: EventPricePlanOption[];
    discounts: EventDiscountOption[];
    location: string;
    rainPolicy: RainPolicy;
    capacity: number | null;
    targetGeneration: string | null;
    themeId: string | null;
    status: EventStatus;
    rsvpDeadline: string | null;
    rsvpOpen: boolean;
    flyerAsset: FlyerAsset | null;
  };
  organizers: EventOrganizerList;
  role: OrganizerRole;
  /** 会員として登録済みの幹事か。未登録の幹事は公開できない。 */
  registered: boolean;
  stats: {
    attendingCount: number;
    declinedCount: number;
    waitlistedCount: number;
    totalResponses: number;
  };
}

const DRAFT_LIST_PATH = "/organizer/events/drafts";

/**
 * 下書きのプレビュー。告知ページ（SCR-PUB-01）と同じ部品で見た目を確かめる。
 *
 * 公開操作は共通ヘッダー直下の全幅バーから行う。チラシ以降は参加者が見る画面の
 * プレビューで、出欠フォームの見た目も出すが操作はできない。
 * 参加履歴・主催者の勧誘カードは出さない。公開が完了すると告知ページへ移る。
 */
export default function PreviewClient({ params }: { params: { id: string } }) {
  const router = useRouter();
  const quotaState = useEventQuota();
  const returnTo = `/organizer/events/${params.id}/preview`;
  const [detail, setDetail] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/organizer/events/${params.id}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readProblem(res));
        return (await res.json()) as PreviewResponse;
      })
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "プレビューの読み込みに失敗しました");
      });
    return () => {
      active = false;
    };
  }, [params.id]);

  const publish = async () => {
    setPublishing(true);
    setToast(null);
    try {
      const res = await fetch(`/api/v1/organizer/events/${params.id}/publish`, { method: "POST" });
      if (res.status === 402) {
        // 枠が無い。購入後にこのプレビューへ戻り、そのまま公開できる。
        quotaState.openPricingModal({ draftId: params.id, returnTo });
        return;
      }
      if (res.status === 403) {
        const problem = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (problem.error === "PHONE_REQUIRED") {
          window.location.href = phoneVerifyUrl(returnTo);
          return;
        }
        if (problem.error === "REGISTER_REQUIRED") {
          router.push(`/organizer/register-required?eventId=${encodeURIComponent(params.id)}`);
          return;
        }
        throw new Error(problem.detail || "公開に失敗しました");
      }
      if (res.status === 409) {
        setToast("このイベントはすでに公開されています。");
        setDetail((current) => (current ? { ...current, event: { ...current.event, status: "PUBLISHED" } } : current));
        return;
      }
      if (!res.ok) throw new Error(await readProblem(res));
      void quotaState.refreshQuota();
      router.replace(`/events/${params.id}`);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "公開に失敗しました");
    } finally {
      setPublishing(false);
    }
  };

  if (error) {
    return (
      <div className="preview-screen__status stack">
        <Alert tone="error">{error}</Alert>
        <Link href="/organizer/events" className="btn btn--outline">
          主催一覧へ戻る
        </Link>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="preview-screen__status">
        <Loading>
          プレビューを読み込んでいます
        </Loading>
      </div>
    );
  }

  const { event, stats, organizers, role, registered } = detail;
  const isDraft = event.status === "DRAFT";
  const canPublish = isDraft && registered && role === "OWNER";

  return (
    <div className="preview-screen">
      <div className="preview-toolbar">
        <div className="preview-toolbar__inner">
          <div className="preview-toolbar__actions">
            {canPublish && (
              <button type="button" className="btn btn--primary btn--sm" disabled={publishing} onClick={() => void publish()}>
                {publishing ? "公開中…" : "公開する"}
              </button>
            )}
            {event.status === "PUBLISHED" && event.flyerAsset && (
              <a
                href={flyerPdfDownloadHref(event.flyerAsset.id, event.id)}
                className="btn btn--primary btn--sm"
              >
                PDFでダウンロード
              </a>
            )}
            <Link href={`/organizer/events/${params.id}/edit`} className="btn btn--outline btn--sm">
              編集に戻る
            </Link>
            <Link href={DRAFT_LIST_PATH} className="btn btn--ghost btn--sm">
              下書き一覧
            </Link>
          </div>
          <p className="preview-toolbar__note">
            公開には、利用枠を 1回使います。公開すると、告知URLが有効になり出欠を受け付けます。
          </p>
        </div>
      </div>

      {(!isDraft || (isDraft && (!registered || role !== "OWNER"))) && (
        <div className="preview-toolbar__status">
          {!isDraft && (
            <Alert tone="success">
              このイベントは公開済みです。{" "}
              <Link href={`/events/${params.id}`} className="text-link">
                告知ページを開く
              </Link>
            </Alert>
          )}
          {isDraft && (!registered || role !== "OWNER") && (
            <Alert tone="warning">
              公開は筆頭幹事（オーナー）の会員だけが行えます。内容の確認と編集はこのまま続けられます。
            </Alert>
          )}
        </div>
      )}

      <div className="preview-screen__banners page--narrow stack">
        <QuotaStatusBanner
          quota={quotaState.quota}
          onOpenPricing={() => quotaState.openPricingModal({ draftId: params.id, returnTo })}
          nextPath={returnTo}
        />
        <VerifyPaymentBanner onVerified={() => void quotaState.refreshQuota()} />
      </div>

      <p className="preview-canvas__label">プレビュー — 参加者が見る画面です。</p>
      <SemanticThemeScope themeId={event.themeId} page>
      <div className="page--narrow event-page">
        <PosterHero title={event.title} flyer={event.flyerAsset} stamp="プレビュー" />
        <EventMetaCard
          event={{
            title: event.title,
            schedules: event.schedules,
            pricePlans: event.pricePlans,
            discounts: event.discounts,
            location: event.location,
            rainPolicy: event.rainPolicy,
            capacity: event.capacity,
            targetGeneration: event.targetGeneration,
            status: event.status,
            rsvpDeadline: event.rsvpDeadline,
            rsvpOpen: event.rsvpOpen,
            attendingCount: stats.attendingCount,
            organizers,
          }}
        />
        <div className="event-body">
          <div className="preview-rsvp">
            <p className="preview-rsvp__note">プレビューのため送信できません。</p>
            <DynamicRsvpBox
              eventId={event.id}
              schedules={event.schedules}
              pricePlans={event.pricePlans}
              discounts={event.discounts}
              initialRsvp={null}
              capacity={event.capacity}
              attendingCount={stats.attendingCount}
              waitlistCount={stats.waitlistedCount}
              closed={false}
              preview
              loginHref={`/participant/login?next=${encodeURIComponent(`/events/${event.id}`)}`}
              onCountChange={() => {}}
            />
          </div>
        </div>
      </div>
      </SemanticThemeScope>

      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quotes={quotaState.quota?.pricing ?? null}
        freeGrantRemaining={quotaState.quota?.freeGrantRemaining}
        currentPlan={quotaState.quota?.subscriptionPlan}
        context="preview"
        onGranted={() => {
          void quotaState.refreshQuota();
          setToast("0円チケットを1回分受け取りました。「公開する」をもう一度押してください。");
        }}
      />
      {toast && <Toast message={toast} tone={toast.includes("失敗") ? "error" : "success"} onClose={() => setToast(null)} />}
    </div>
  );
}
