"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  type EventDiscountOption,
  type EventFormValues,
  type EventPricePlanOption,
  type EventScheduleOption,
  type EventStatus,
  type FlyerAsset,
} from "@/modules/events/types";
import {
  EVENT_SUMMARY_MAX_LENGTH,
  summaryTextLength,
} from "@/modules/events/lib/summary";
import { Alert, Loading } from "@/components/ui";

interface DetailResponse {
  event: {
    id: string;
    title: string;
    /** 公開ページの冒頭に出す概要。許可タグだけの HTML。 */
    summary: string | null;
    schedules: EventScheduleOption[];
    pricePlans: EventPricePlanOption[];
    discounts: EventDiscountOption[];
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

/** 複製の直後に出す案内。印は URL から消して、再読み込みで繰り返さない。 */
const CLONE_NOTICE = "開催日を1か月後にずらしました。日付を確かめてください。";

function EditEventScreen({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  /** 押された保存の種類。帯のボタンの文言を、押した側だけに出す。 */
  const [saveIntent, setSaveIntent] = useState<"draft" | "preview" | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("error");
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
        summary: detail.event.summary ?? "",
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

  // 複製から来たときの案内。日付を1か月ずらしたことを、編集に入る前に伝える。
  // URL からは印を消して、再読み込みや戻るで同じ案内を繰り返さない。
  useEffect(() => {
    if (searchParams.get("cloned") !== "1") return;
    setToast(CLONE_NOTICE);
    setToastTone("success");
    router.replace(`/organizer/events/${params.id}/edit`);
  }, [searchParams, router, params.id]);

  /** トーストは色も一緒に持つ。文言だけで成功・失敗を推測させない。 */
  const showToast = (message: string, tone: "success" | "error") => {
    setToast(message);
    setToastTone(tone);
  };

  /** 概要は任意だが、200 字を超えると保存できない。送る前に画面で知らせる。 */
  const summaryIsValid = () => {
    if (summaryTextLength(form.summary) > EVENT_SUMMARY_MAX_LENGTH) {
      showToast(`イベント概要は${EVENT_SUMMARY_MAX_LENGTH}文字以内にしてください。`, "error");
      return false;
    }
    return true;
  };

  /** 公開済み・受付停止の保存。保存したらロックを解いて主催一覧へ戻る。 */
  const save = async () => {
    if (!summaryIsValid()) return;
    setSaving(true);
    try {
      await lock.saveWithLock(toEventRequest(form));
      await lock.releaseAwait();
      router.push("/organizer/events");
    } catch (cause) {
      // 下書きの公開でチケットが足りない。編集内容は画面に残したまま、購入へ誘う。
      if (cause instanceof RequestProblemError && cause.status === 402) {
        setSaving(false);
        quotaState.openPricingModal({ draftId: params.id, returnTo });
        return;
      }
      showToast(cause instanceof Error ? cause.message : "保存に失敗しました", "error");
      setSaving(false);
    }
  };

  /**
   * 下書きの保存。保存しても画面に留まり、そのままプレビューへ進める。
   * `goPreview` が true のときは、入力した内容を保存してから SCR-ORG-16 へ移る
   * （古い保存内容を確認して公開してしまわないように）。
   */
  const saveDraft = async (goPreview: boolean) => {
    if (!summaryIsValid()) return;
    setSaving(true);
    setSaveIntent(goPreview ? "preview" : "draft");
    try {
      const saved = (await lock.saveWithLock(toEventRequest(form))) as {
        event: { status: EventStatus } & Pick<DetailResponse["event"], "schedules" | "pricePlans" | "discounts">;
      };
      // 新しく足した開催日・料金プランには ID が無い。保存の応答で入れ替えて、
      // もう一度保存したときに作り直されないようにする。
      setForm((current) => ({
        ...current,
        ...draftsFromOptions(saved.event),
        status: saved.event.status,
      }));
      if (goPreview) {
        // 遷移するまでボタンは止めたまま（二重保存を防ぐ）。
        router.push(`/organizer/events/${params.id}/preview`);
        return;
      }
      if (saved.event.status !== "DRAFT") {
        // 公開状態を「公開中」に変えて保存した。公開の完了なので一覧へ移る。
        await lock.releaseAwait();
        router.push("/organizer/events");
        return;
      }
      showToast("下書きを保存しました。プレビューで確かめてから公開できます。", "success");
    } catch (cause) {
      if (cause instanceof RequestProblemError && cause.status === 402) {
        setSaving(false);
        setSaveIntent(null);
        quotaState.openPricingModal({ draftId: params.id, returnTo });
        return;
      }
      showToast(cause instanceof Error ? cause.message : "保存に失敗しました", "error");
    }
    setSaving(false);
    setSaveIntent(null);
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

  const isDraft = form.status === "DRAFT";

  return (
    <div className={`page--form stack${isDraft ? " has-action-dock" : ""}`}>
      <div>
        <h1 className="page-title">イベントの編集</h1>
        {form.title ? (
          <p className="page-lead">
            {form.title} ／ {form.status === "DRAFT" ? "下書き" : form.status === "PUBLISHED" ? "公開中" : "受付停止"}
          </p>
        ) : null}
        <div className="panel__actions">
          {/* 下書きのプレビューは、下の帯の「プレビューを確認して公開」が受ける。
              ここに残すと、保存していない内容で確認してしまう入口が二重になる。 */}
          {!isDraft && (
            <Link href={`/organizer/events/${params.id}/preview`} className="btn btn--outline btn--sm">
              プレビュー
            </Link>
          )}
          <Link href="/organizer/events" className="btn btn--ghost btn--sm">
            一覧へ戻る
          </Link>
        </div>
      </div>
      {lock.hasLock && (
        <div className="notice">
          編集中は、ほかの人は保存できません。保存すると解除されます。
        </div>
      )}
      {lock.status === "conflict" && !lock.conflictVisible && (
        <Alert tone="warning" as="div" className="alert--compact">
          <p>{lock.conflict?.holderName}さんが編集中です。保存するには編集権を引き継いでください。</p>
          <button type="button" className="btn btn--sm btn--outline" onClick={lock.reopenConflict}>
            編集権を引き継ぐ
          </button>
        </Alert>
      )}
      <VerifyPaymentBanner onVerified={() => void quotaState.refreshQuota()} />
      {isDraft && (
        <QuotaStatusBanner
          quota={quotaState.quota}
          loading={quotaState.isLoading}
          onPurchaseTicket={() => quotaState.startOneTimeCheckout({ draftId: params.id, returnTo })}
          onGranted={() => void quotaState.refreshQuota()}
          nextPath={returnTo}
        />
      )}
      {lock.status === "acquiring" && (
        <Loading>
          編集を開始しています…
        </Loading>
      )}
      {lock.error && <Alert tone="error">{lock.error}</Alert>}
      {role !== null && <CoHostPanel eventId={params.id} />}
      <EventForm
        value={form}
        onChange={setForm}
        onSubmit={() => void (isDraft ? saveDraft(false) : save())}
        submitting={saving}
        disabled={!lock.hasLock}
        showStatus
        hideSubmit={isDraft}
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
      {/* 下書きの操作は画面下に固定する。長いフォームを読み終えても、
          保存とプレビューまで戻らずに押せるようにするため。主操作（朱）は
          「プレビューを確認して公開」の 1 つだけにする。 */}
      {isDraft && (
        <div className="action-dock">
          <div className="action-dock__inner">
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={!lock.hasLock || saving}
              onClick={() => void saveDraft(false)}
            >
              {saving && saveIntent === "draft" ? "保存しています…" : "下書き保存"}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!lock.hasLock || saving}
              onClick={() => void saveDraft(true)}
            >
              {saving && saveIntent === "preview" ? "保存しています…" : "プレビューを確認して公開"}
            </button>
          </div>
        </div>
      )}
      <LockConflictModal
        isOpen={lock.conflictVisible}
        holderName={lock.conflict?.holderName ?? ""}
        takingOver={takingOver}
        onDismiss={lock.dismissConflict}
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
        quota={quotaState.quota}
        context="edit"
        onUseTicket={() => void save()}
        onGranted={() => {
          void quotaState.refreshQuota();
          showToast("0円チケットを受け取りました。もう一度保存してください。", "success");
        }}
      />
      {toast && <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />}
    </div>
  );
}

export default function EditEventPage({ params }: { params: { id: string } }) {
  // 複製の案内（`?cloned=1`）を読むため、`useSearchParams` を使う層は Suspense で包む。
  return (
    <Suspense
      fallback={
        <Loading>
          編集画面を準備しています
        </Loading>
      }
    >
      <EditEventScreen params={params} />
    </Suspense>
  );
}
