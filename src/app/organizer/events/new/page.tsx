"use client";

import { Suspense, useState } from "react";
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
import { readFlyerDraftKey } from "@/modules/flyers/lib/draft";
import { applyFlyerToForm, EMPTY_EVENT_FORM, toEventRequest, type EventFormValues } from "@/modules/events/types";

function NewEventScreen() {
  const quotaState = useEventQuota();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 告知ページの勧誘カードから来たときの参照元。登録を挟んでも消えないよう next にも載せる。
  const referrerEventId = searchParams.get("ref");
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("error");
  // 未登録で1件公開した端末が2件目を作ろうとしたとき。この画面には eventId がまだ無いので、その場で登録へ誘う。
  const [registerRequired, setRegisterRequired] = useState(false);
  const [published, setPublished] = useState<{ publicUrl: string; manageUrl: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 参照元を保ったまま、この作成画面へ戻るパス。
  const nextPath = referrerEventId
    ? `/organizer/events/new?ref=${encodeURIComponent(referrerEventId)}`
    : "/organizer/events/new";

  const applyFlyer = (flyer: SelectableFlyer) => {
    setForm((current) => applyFlyerToForm(current, flyer));
    setFlyerPreview(flyer.imageUrl);
  };

  const publish = async () => {
    setSubmitting(true);
    setToast(null);
    setRegisterRequired(false);
    try {
      const res = await fetch("/api/v1/public/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toEventRequest(form, referrerEventId),
          // 作成中に使ったチラシの回数を、公開後のイベントの枠へ引き継ぐ。
          flyerDraftKey: readFlyerDraftKey("new"),
        }),
      });
      if (res.status === 402) {
        quotaState.openPricingModal();
        return;
      }
      if (res.status === 403) {
        const problem = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (problem.error === "PHONE_REQUIRED") {
          window.location.href = `/auth/register?step=phone&next=${encodeURIComponent(nextPath)}`;
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
        publicUrl: string;
        manageUrl: string;
        guestOrganizerToken?: string | null;
      };
      void quotaState.refreshQuota();
      if (data.guestOrganizerToken) {
        // 未登録の幹事は、出欠を見る前に会員登録が要る。公開直後にその旨を伝える専用ページへ送る。
        router.replace(`/organizer/register-required?eventId=${encodeURIComponent(data.event.id)}`);
        return;
      }
      setPublished({ publicUrl: data.publicUrl, manageUrl: data.manageUrl });
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
      <QuotaStatusBanner quota={quotaState.quota} onOpenPricing={quotaState.openPricingModal} nextPath={nextPath} />
      {registerRequired && (
        <section className="card card--padded stack">
          <div>
            <h2 className="panel__title">2件目からは会員登録が必要です</h2>
            <p className="help">
              未登録のまま作れるイベントは1件だけです。会員登録すると、この端末で公開したイベントもあなたのアカウントに引き継がれます。
            </p>
          </div>
          <Link
            href={`/auth/register?mode=register&next=${encodeURIComponent(nextPath)}`}
            className="btn btn--primary btn--block"
          >
            会員登録する
          </Link>
          <Link
            href={`/auth/register?mode=login&next=${encodeURIComponent(nextPath)}`}
            className="btn btn--outline btn--block"
          >
            すでに会員の方はログイン
          </Link>
        </section>
      )}
      <EventForm
        value={form}
        onChange={setForm}
        onSubmit={() => void publish()}
        submitting={submitting}
        submitLabel="公開する"
        showOrganizerName={!quotaState.isLoading && !quotaState.quota}
        flyerSlot={
          <>
            <FlyerGeneratePanel
              value={form}
              disabled={submitting}
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
            <button type="button" className="btn btn--outline" disabled={submitting} onClick={() => setPickerOpen(true)}>
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
