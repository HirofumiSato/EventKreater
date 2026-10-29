"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EventForm } from "@/modules/events/components/EventForm";
import { FlyerGeneratePanel } from "@/modules/flyers/components/FlyerGeneratePanel";
import { FlyerSelectModal, type SelectableFlyer } from "@/modules/flyers/components/FlyerSelectModal";
import { CoHostPanel } from "@/modules/organizers/components/CoHostPanel";
import { LockConflictModal } from "@/modules/organizers/components/LockConflictModal";
import { Toast } from "@/components/common/Toast";
import { useEditLock } from "@/modules/organizers/hooks/useEditLock";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem, RequestProblemError } from "@/lib/problem";
import { normalizeSemanticThemeId } from "@/lib/semantic-themes";
import { formatRsvpDeadlineInput } from "@/lib/serializers";
import {
  applyFlyerToForm,
  draftsFromOptions,
  EMPTY_EVENT_FORM,
  toEventRequest,
  type EventFormValues,
  type EventPricePlanOption,
  type EventScheduleOption,
  type EventStatus,
  type FlyerAsset,
} from "@/modules/events/types";
import { Alert, Loading } from "@/components/ui";

interface DetailResponse {
  event: {
    id: string;
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
    targetGeneration: string | null;
    themeId: string | null;
    flyerAssetId: string | null;
    rsvpDeadline: string | null;
    status: EventStatus;
    flyerAsset: FlyerAsset | null;
  };
  stats: { attendingCount: number; declinedCount: number; totalResponses: number };
  role: "OWNER" | "CO_HOST";
}

export default function EditEventPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const quotaState = useEventQuota();
  const returnTo = `/organizer/events/${params.id}/edit`;
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [holderName, setHolderName] = useState("");
  const [role, setRole] = useState<"OWNER" | "CO_HOST" | null>(null);
  const [pricingModeLocked, setPricingModeLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const lock = useEditLock(params.id, holderName, ready && holderName.length > 0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [profileRes, eventRes] = await Promise.all([
        fetch("/api/v1/user/profile"),
        fetch(`/api/v1/organizer/events/${params.id}`),
      ]);
      if (!eventRes.ok) {
        if (active) setError(await readProblem(eventRes));
        return;
      }
      const detail = (await eventRes.json()) as DetailResponse;
      let name = "ゲスト幹事";
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as { user: { name: string } };
        name = profile.user.name;
      }
      if (!active) return;
      setHolderName(name);
      setRole(detail.role);
      // 下書きは回答を受け付けないため対象外。公開・受付停止で出席者がいると切り替え不可。
      setPricingModeLocked(
        (detail.event.status === "PUBLISHED" || detail.event.status === "CLOSED") &&
          (detail.stats?.attendingCount ?? 0) > 0,
      );
      setForm({
        title: detail.event.title,
        // 会員の表示名はサーバーが解決するので、編集では使わない。
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
        targetGeneration: detail.event.targetGeneration ?? "",
        themeId: normalizeSemanticThemeId(detail.event.themeId),
        flyerAssetId: detail.event.flyerAssetId,
        rsvpDeadline: detail.event.rsvpDeadline ? formatRsvpDeadlineInput(new Date(detail.event.rsvpDeadline)) : "",
        status: detail.event.status,
      });
      setFlyerPreview(detail.event.flyerAsset?.imageUrl ?? null);
      setReady(true);
    };
    void load().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
    });
    return () => {
      active = false;
    };
  }, [params.id]);

  const save = async () => {
    setSaving(true);
    try {
      await lock.saveWithLock(toEventRequest(form));
      await lock.releaseAwait();
      router.push("/organizer/events");
    } catch (cause) {
      // 下書きの公開で枠が足りない。編集内容は画面に残したまま、購入へ誘う。
      if (cause instanceof RequestProblemError && cause.status === 402) {
        setSaving(false);
        quotaState.openPricingModal({ draftId: params.id, returnTo });
        return;
      }
      setToast(cause instanceof Error ? cause.message : "保存に失敗しました");
      setSaving(false);
    }
  };

  const applyFlyer = (flyer: SelectableFlyer) => {
    setForm((current) => applyFlyerToForm(current, flyer));
    setFlyerPreview(flyer.imageUrl);
  };

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!ready) {
    return (
      <Loading>
        編集画面を準備しています
      </Loading>
    );
  }

  return (
    <div className="page--form stack">
      <div>
        <h1 className="page-title">イベントの編集</h1>
        {form.title ? (
          <p className="page-lead">
            {form.title} ／ {form.status === "DRAFT" ? "下書き" : form.status === "PUBLISHED" ? "公開中" : "受付停止"}
          </p>
        ) : null}
        <div className="panel__actions">
          <Link href={`/organizer/events/${params.id}/preview`} className="btn btn--outline btn--sm">
            プレビュー
          </Link>
          <Link href="/organizer/events" className="btn btn--ghost btn--sm">
            一覧へ戻る
          </Link>
        </div>
      </div>
      {lock.hasLock && (
        <div className="notice">
          いま編集中のあいだ、ほかの人は保存できません。保存すると、この制限は解除されます。
        </div>
      )}
      <VerifyPaymentBanner onVerified={() => void quotaState.refreshQuota()} />
      {form.status === "DRAFT" && (
        <QuotaStatusBanner
          quota={quotaState.quota}
          onOpenPricing={() => quotaState.openPricingModal({ draftId: params.id, returnTo })}
          nextPath={returnTo}
        />
      )}
      {lock.status === "acquiring" && (
        <Loading>
          編集を開始しています
        </Loading>
      )}
      {lock.error && <Alert tone="error">{lock.error}</Alert>}
      {role === "OWNER" && <CoHostPanel eventId={params.id} />}
      <EventForm
        value={form}
        onChange={setForm}
        onSubmit={() => void save()}
        submitting={saving}
        disabled={!lock.hasLock}
        showStatus
        submitLabel="保存して一覧へ戻る"
        pricingModeLocked={pricingModeLocked}
        flyerSlot={
          <>
            <FlyerGeneratePanel
              value={form}
              disabled={!lock.hasLock || saving}
              previewUrl={flyerPreview}
              flyerAssetId={form.flyerAssetId}
              draftScope={`event:${params.id}`}
              eventId={params.id}
              published={form.status === "PUBLISHED"}
              onGenerated={(asset) => {
                setForm((current) => ({ ...current, flyerAssetId: asset.id }));
                setFlyerPreview(asset.imageUrl);
              }}
              onClear={() => {
                setForm((current) => ({ ...current, flyerAssetId: null }));
                setFlyerPreview(null);
              }}
            />
            <button type="button" className="btn btn--outline" disabled={!lock.hasLock || saving} onClick={() => setPickerOpen(true)}>
              過去のチラシから選ぶ
            </button>
            <FlyerSelectModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={applyFlyer} title={form.title} />
          </>
        }
      />
      <LockConflictModal
        isOpen={lock.status === "conflict" && Boolean(lock.conflict)}
        holderName={lock.conflict?.holderName ?? ""}
        takingOver={takingOver}
        onRetry={() => void lock.refresh()}
        onTakeover={async () => {
          setTakingOver(true);
          try {
            await lock.forceTakeover();
          } finally {
            setTakingOver(false);
          }
        }}
      />
      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quotes={quotaState.quota?.pricing ?? null}
        freeGrantRemaining={quotaState.quota?.freeGrantRemaining}
        currentPlan={quotaState.quota?.subscriptionPlan}
        context="edit"
        onGranted={() => {
          void quotaState.refreshQuota();
          setToast("0円チケットを1回分受け取りました。「保存して一覧へ戻る」をもう一度押してください。");
        }}
      />
      {toast && <Toast message={toast} tone={toast === "保存しました" ? "success" : "error"} onClose={() => setToast(null)} />}
    </div>
  );
}
