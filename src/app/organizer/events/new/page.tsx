"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EventForm } from "@/modules/events/components/EventForm";
import { FlyerGeneratePanel } from "@/modules/flyers/components/FlyerGeneratePanel";
import { FlyerSelectModal, type SelectableFlyer } from "@/modules/flyers/components/FlyerSelectModal";
import { PublishSuccessModal } from "@/modules/organizers/components/PublishSuccessModal";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { Toast } from "@/components/common/Toast";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem } from "@/lib/problem";
import { SITE } from "@/lib/site";
import { loginUrl, phoneVerifyUrl, registerUrl } from "@/lib/auth-links";
import { formatRsvpDeadlineInput } from "@/lib/serializers";
import { readFlyerDraftKey } from "@/modules/flyers/lib/draft";
import {
  applyFlyerToForm,
  draftsFromOptions,
  EMPTY_EVENT_FORM,
  toEventRequest,
  type EventFormValues,
  type EventPricePlanOption,
  type EventScheduleOption,
  type FlyerAsset,
} from "@/modules/events/types";

/** 復元する下書きの取得結果。編集画面と同じ形。 */
interface DraftDetailResponse {
  event: {
    title: string;
    schedules: EventScheduleOption[];
    pricePlans: EventPricePlanOption[];
    location: EventFormValues["location"];
    postalCode: string | null;
    prefecture: string | null;
    city: string | null;
    town: string | null;
    addressLine: string | null;
    building: string | null;
    venueName: string | null;
    rainPolicy: EventFormValues["rainPolicy"];
    capacity: number | null;
    flyerAssetId: string | null;
    rsvpDeadline: string | null;
    flyerAsset: FlyerAsset | null;
  };
}

function NewEventScreen() {
  const quotaState = useEventQuota();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 告知ページの勧誘カードから来たときの参照元。登録を挟んでも消えないよう next にも載せる。
  const referrerEventId = searchParams.get("ref");
  // 枠が無いときに保存した下書き。購入後はこの ID で復元し、公開は専用 API を呼ぶ。
  const draftIdParam = searchParams.get("draftId");
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM);
  const [draftId, setDraftId] = useState<string | null>(draftIdParam);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(Boolean(draftIdParam));
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("error");
  // 未登録で1件公開した端末が2件目を作ろうとしたとき。この画面には eventId がまだ無いので、その場で登録へ誘う。
  const [registerRequired, setRegisterRequired] = useState(false);
  const [published, setPublished] = useState<{ publicUrl: string; manageUrl: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 参照元を保ったまま、この作成画面へ戻るパス。購入後の戻り先にも使う。
  const nextPath = referrerEventId
    ? `${SITE.nav.createEvent.href}?ref=${encodeURIComponent(referrerEventId)}`
    : SITE.nav.createEvent.href;

  // 購入後に戻ってきたとき、下書きの内容をフォームへ戻す。
  useEffect(() => {
    if (!draftIdParam) return;
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/v1/organizer/events/${draftIdParam}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readProblem(res));
      const detail = (await res.json()) as DraftDetailResponse;
      if (!active) return;
      setForm({
        title: detail.event.title,
        // 会員の表示名はサーバーが解決するので、復元では使わない。
        organizerDisplayName: "",
        ...draftsFromOptions(detail.event),
        location: detail.event.location,
        postalCode: detail.event.postalCode ?? "",
        prefecture: detail.event.prefecture ?? "",
        city: detail.event.city ?? "",
        town: detail.event.town ?? "",
        addressLine: detail.event.addressLine ?? "",
        building: detail.event.building ?? "",
        venueName: detail.event.venueName ?? "",
        rainPolicy: detail.event.rainPolicy,
        capacity: detail.event.capacity,
        flyerAssetId: detail.event.flyerAssetId,
        rsvpDeadline: detail.event.rsvpDeadline
          ? formatRsvpDeadlineInput(new Date(detail.event.rsvpDeadline))
          : "",
        status: "DRAFT",
      });
      setFlyerPreview(detail.event.flyerAsset?.imageUrl ?? null);
      setDraftId(draftIdParam);
    };
    void load()
      .catch((cause: unknown) => {
        if (!active) return;
        setToastTone("error");
        setToast(cause instanceof Error ? cause.message : "下書きの読み込みに失敗しました");
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [draftIdParam]);

  const applyFlyer = (flyer: SelectableFlyer) => {
    setForm((current) => applyFlyerToForm(current, flyer));
    setFlyerPreview(flyer.imageUrl);
  };

  const openPricing = (id: string | null) => {
    quotaState.openPricingModal({ ...(id ? { draftId: id } : {}), returnTo: nextPath });
  };

  /** 下書きを公開する。入力中の内容も一緒に保存する。 */
  const publishDraft = async (id: string) => {
    const res = await fetch(`/api/v1/organizer/events/${id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toEventRequest(form, referrerEventId)),
    });
    if (res.status === 402) {
      openPricing(id);
      return;
    }
    if (res.status === 409) {
      setToastTone("error");
      setToast("このイベントはすでに公開されています。主催イベント一覧から確認してください。");
      return;
    }
    if (!res.ok) throw new Error(await readProblem(res));
    const data = (await res.json()) as { publicUrl: string; manageUrl: string };
    void quotaState.refreshQuota();
    setPublished({ publicUrl: data.publicUrl, manageUrl: data.manageUrl });
  };

  const publish = async () => {
    setSubmitting(true);
    setToast(null);
    setRegisterRequired(false);
    const payload = {
      ...toEventRequest(form, referrerEventId),
      // 新規作成中に使ったチラシの回数を、公開後のイベントの枠へ引き継ぐ。
      ...(draftId ? {} : { flyerDraftKey: readFlyerDraftKey("new") }),
    };
    try {
      if (draftId) {
        await publishDraft(draftId);
        return;
      }
      const res = await fetch("/api/v1/public/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, status: "PUBLISHED" }),
      });
      if (res.status === 402) {
        // 枠が無い。入力内容を下書きとして残してから課金へ進む。
        const draftRes = await fetch("/api/v1/public/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, status: "DRAFT" }),
        });
        if (draftRes.ok) {
          const draft = (await draftRes.json()) as { event: { id: string } };
          setDraftId(draft.event.id);
          openPricing(draft.event.id);
          setToastTone("success");
          setToast("入力内容を下書きに保存しました。購入後、この画面に戻ると続きから公開できます。");
          return;
        }
        openPricing(null);
        return;
      }
      if (res.status === 403) {
        const problem = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (problem.error === "PHONE_REQUIRED") {
          window.location.href = phoneVerifyUrl(nextPath);
          return;
        }
        if (problem.error === "REGISTER_REQUIRED") {
          // 未登録で作れるのは1件だけ。2件目は登録へ送る（イベントはまだ作られていない）。
          setRegisterRequired(true);
          return;
        }
        throw new Error(problem.detail || "公開に失敗しました");
      }
      if (!res.ok) throw new Error(await readProblem(res));
      const data = (await res.json()) as {
        event: { id: string };
        publicUrl: string | null;
        manageUrl: string;
        guestOrganizerToken?: string | null;
      };
      void quotaState.refreshQuota();
      if (data.guestOrganizerToken) {
        // 未登録の幹事は、出欠を見る前に会員登録が要る。公開直後にその旨を伝える専用ページへ送る。
        router.replace(`/organizer/register-required?eventId=${encodeURIComponent(data.event.id)}`);
        return;
      }
      if (data.publicUrl) {
        setPublished({ publicUrl: data.publicUrl, manageUrl: data.manageUrl });
      }
    } catch (cause) {
      setToastTone("error");
      setToast(cause instanceof Error ? cause.message : "公開に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page--form stack">
      <div>
        <h1 className="page-title">新規イベント作成</h1>
        <p className="page-lead">日時と費用プランは複数登録できます。ログイン時は利用枠を消費します。</p>
      </div>
      <VerifyPaymentBanner onVerified={() => void quotaState.refreshQuota()} />
      {draftId && !restoring && (
        <p className="alert alert--success">
          下書きを復元しました。内容を確認して「公開する」を押してください。
        </p>
      )}
      <QuotaStatusBanner quota={quotaState.quota} onOpenPricing={() => openPricing(draftId)} nextPath={nextPath} />
      {registerRequired && (
        <section className="card card--padded stack">
          <div>
            <h2 className="panel__title">2件目からは会員登録が必要です</h2>
            <p className="help">
              未登録のまま作れるイベントは1件だけです。会員登録すると、この端末で公開したイベントもあなたのアカウントに引き継がれます。
            </p>
          </div>
          <Link href={registerUrl(nextPath)} className="btn btn--primary btn--block">
            会員登録する
          </Link>
          <Link href={loginUrl(nextPath)} className="btn btn--outline btn--block">
            すでに会員の方はログイン
          </Link>
        </section>
      )}
      <EventForm
        value={form}
        onChange={setForm}
        onSubmit={() => void publish()}
        submitting={submitting || restoring}
        submitLabel="公開する"
        showOrganizerName={!quotaState.isLoading && !quotaState.quota}
        flyerSlot={
          <>
            <FlyerGeneratePanel
              value={form}
              disabled={submitting || restoring}
              previewUrl={flyerPreview}
              draftScope="new"
              onGenerated={(asset) => {
                setForm((current) => ({ ...current, flyerAssetId: asset.id }));
                setFlyerPreview(asset.imageUrl);
              }}
              onClear={() => {
                setForm((current) => ({ ...current, flyerAssetId: null }));
                setFlyerPreview(null);
              }}
            />
            <button
              type="button"
              className="btn btn--outline"
              disabled={submitting || restoring}
              onClick={() => setPickerOpen(true)}
            >
              過去のチラシから選ぶ
            </button>
            <FlyerSelectModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={applyFlyer} />
          </>
        }
      />
      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quotes={quotaState.quota?.pricing ?? null}
        freeGrantRemaining={quotaState.quota?.freeGrantRemaining}
        context="create"
        onGranted={() => {
          setToastTone("success");
          setToast("0円チケットを1回分受け取りました。「公開する」をもう一度押してください。");
        }}
      />
      {published && (
        <PublishSuccessModal publicUrl={published.publicUrl} manageUrl={published.manageUrl} onClose={() => setPublished(null)} />
      )}
      {toast && <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />}
    </div>
  );
}

export default function NewEventPage() {
  return (
    <Suspense
      fallback={
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          読み込んでいます
        </p>
      }
    >
      <NewEventScreen />
    </Suspense>
  );
}
