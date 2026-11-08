"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EventStepForm } from "@/modules/events/components/EventStepForm";
import { VoiceInputDock } from "@/modules/events/components/VoiceInputDock";
import { FlyerGeneratePanel } from "@/modules/flyers/components/FlyerGeneratePanel";
import { FlyerSelectModal, type SelectableFlyer } from "@/modules/flyers/components/FlyerSelectModal";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { Toast } from "@/components/common/Toast";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem } from "@/lib/problem";
import { normalizeSemanticThemeId } from "@/lib/semantic-themes";
import { SITE } from "@/lib/site";
import { phoneVerifyUrl, registerUrl } from "@/lib/auth-links";
import { formatRsvpDeadlineInput } from "@/lib/serializers";
import { readFlyerDraftKey } from "@/modules/flyers/lib/draft";
import { savePendingForm, takePendingForm } from "@/modules/events/lib/pending-form";
import { isEventGuideDismissed } from "@/modules/events/lib/tour/memory";
import {
  applyFlyerToForm,
  draftsFromOptions,
  EMPTY_EVENT_FORM,
  toEventRequest,
  type EventFormValues,
  type EventPricePlanOption,
  type EventDiscountOption,
  type EventScheduleOption,
  type FlyerAsset,
} from "@/modules/events/types";
import { Alert, Loading, PageHeader } from "@/components/ui";

/** 復元する下書きの取得結果。編集画面と同じ形。 */
interface DraftDetailResponse {
  event: {
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
    flyerAsset: FlyerAsset | null;
  };
}

function NewEventScreen() {
  const quotaState = useEventQuota();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 告知ページの勧誘カードから来たときの参照元。登録を挟んでも消えないよう next にも載せる。
  const referrerEventId = searchParams.get("ref");
  // チケットが無いときに保存した下書き。購入後はこの ID で復元し、公開は専用 API を呼ぶ。
  const draftIdParam = searchParams.get("draftId");
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM);
  const [draftId, setDraftId] = useState<string | null>(draftIdParam);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  // 下書き、または登録前に退避した内容の読み込みが終わるまで、フォームの操作を止める。
  const [restoring, setRestoring] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("error");
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * 初回ガイド（スポットライトツアー）を出すか。記憶は端末にしか無いので、
   * サーバーが返した HTML と食い違わないよう「読み終わるまでは出さない」から始める。
   * 読み終わる前を `null` にしているのは、音声ガイドの待ちを決めるため。`false` から
   * 始めると、記憶を読む前の 1 描画で音声ガイドが出てしまい、ツアーと二重になる。
   */
  const [guideDismissed, setGuideDismissed] = useState<boolean | null>(null);
  /** 利用者がツアーを閉じたか。閉じたら音声ガイドへ渡す。 */
  const [tourClosed, setTourClosed] = useState(false);

  useEffect(() => {
    setGuideDismissed(isEventGuideDismissed());
  }, []);

  // 参照元を保ったまま、この作成画面へ戻るパス。購入後の戻り先にも使う。
  const nextPath = referrerEventId
    ? `${SITE.nav.createEvent.href}?ref=${encodeURIComponent(referrerEventId)}`
    : SITE.nav.createEvent.href;

  // 下書きは会員だけが保存できる。未登録の幹事には登録・ログインの 2 択を出す。
  // 下書きの枠が空いているか（`quota.canSaveDraft`）とは別の意味なので、名前を分ける。
  const signedIn = !quotaState.isLoading && Boolean(quotaState.quota);
  // 下書きの枠が空いていないか。復元（`draftId`）で来た人は既存の下書きを直すので、枠を見ない。
  const draftQuotaFull =
    !draftIdParam && !restoring && quotaState.quota?.canSaveDraft === false;

  /**
   * 初回ガイドを出す条件。下書きの復元で来た人には出さない（続きを書く邪魔になる）。
   * 入力の復元とチケットの読み込みが終わるまでは待つ。途中で出すと、読み込みで
   * 画面が伸びたときに穴の位置がずれる。
   */
  const tourEnabled =
    !draftIdParam &&
    !restoring &&
    !quotaState.isLoading &&
    guideDismissed === false &&
    !tourClosed;
  /**
   * 音声ガイドを待たせるか。ツアーを出す経路では閉じるまで true、出さない経路
   * （記憶済み・下書き復元）では最初から false にして、これまでどおり出す。
   * 記憶を読む前（`null`）も待たせる。読んだ結果ツアーを出さないと決まったら、
   * この値が false になって音声ガイドが出る。
   */
  const guideDeferred = !draftIdParam && guideDismissed !== true && !tourClosed;

  // 購入後に戻ってきたときは下書きを、登録・ログインから戻ってきたときは
  // 退避した入力をフォームへ戻す。どちらも 1 度だけ読む。
  useEffect(() => {
    if (!draftIdParam) {
      const pending = takePendingForm();
      if (pending) {
        setForm(pending.form);
        setFlyerPreview(pending.flyerPreview);
        setToastTone("success");
        setToast("入力した内容を復元しました。下書き保存かプレビューを選んでください。");
      }
      setRestoring(false);
      return;
    }
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/v1/organizer/events/${draftIdParam}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readProblem(res));
      const detail = (await res.json()) as DraftDetailResponse;
      if (!active) return;
      setForm({
        title: detail.event.title,
        summary: detail.event.summary ?? "",
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
        targetGeneration: detail.event.targetGeneration ?? "",
        themeId: normalizeSemanticThemeId(detail.event.themeId),
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

  /** 下書き ID を URL に残す。再読み込みや購入後の戻りでも同じ下書きを開けるようにする。 */
  const draftPath = (id: string) =>
    `${nextPath}${nextPath.includes("?") ? "&" : "?"}draftId=${encodeURIComponent(id)}`;

  /**
   * 下書きとして保存する。`goPreview` が true なら保存後にプレビューへ進む。
   * 1回目はイベントの作成（`status: DRAFT`）を兼ね、2回目以降はロック不要の保存 API を呼ぶ。
   */
  const saveDraft = async (goPreview: boolean) => {
    setSavingDraft(true);
    setToast(null);
    const payload = {
      ...toEventRequest(form, referrerEventId),
      status: "DRAFT" as const,
      // 作成中に作ったチラシの回数を、公開後のイベントの枠へ引き継ぐ。既存の下書きでは付け替え済み。
      ...(draftId ? {} : { flyerDraftKey: readFlyerDraftKey("new") }),
    };
    try {
      let id = draftId;
      if (id) {
        const res = await fetch(`/api/v1/organizer/events/${id}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 409) {
          // すでに公開済み。保存はできないが、プレビュー側でその旨を出す。
          router.push(`/organizer/events/${id}/preview`);
          return;
        }
        if (!res.ok) throw new Error(await readProblem(res));
      } else {
        const res = await fetch("/api/v1/public/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 403) {
          const problem = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
          if (problem.error === "PHONE_REQUIRED") {
            window.location.href = phoneVerifyUrl(nextPath);
            return;
          }
          if (problem.error === "REGISTER_REQUIRED") {
            // セッションが切れていた。入力を退避してから登録へ送り、戻ったら続きを書けるようにする。
            savePendingForm(form, flyerPreview);
            window.location.href = registerUrl(nextPath);
            return;
          }
          throw new Error(problem.detail || "下書きの保存に失敗しました");
        }
        if (!res.ok) throw new Error(await readProblem(res));
        const data = (await res.json()) as { event: { id: string } };
        id = data.event.id;
        setDraftId(id);
        router.replace(draftPath(id), { scroll: false });
      }
      void quotaState.refreshQuota();
      if (goPreview) {
        router.push(`/organizer/events/${id}/preview`);
        return;
      }
      setToastTone("success");
      setToast("下書きを保存しました。プレビューで見た目を確かめてから公開できます。");
    } catch (cause) {
      setToastTone("error");
      setToast(cause instanceof Error ? cause.message : "下書きの保存に失敗しました");
    } finally {
      setSavingDraft(false);
    }
  };

  /**
   * 未ログインの主催者の最終操作。入力を退避してから認証画面へ送る。
   * 新規の主催者が多数派なので、登録から始める（既存会員は画面側でログインへ切り替える）。
   * 戻ってきたらこの画面で復元し、下書き保存かプレビューを選び直せる。
   */
  const goAuth = () => {
    savePendingForm(form, flyerPreview);
    window.location.href = registerUrl(nextPath);
  };

  return (
    <div className="page--form stack">
      <PageHeader eyebrow="5ステップ" title="新規イベント作成" />
      <VerifyPaymentBanner onVerified={() => void quotaState.refreshQuota()} />
      {draftId && !restoring && (
        <Alert tone="success">
          下書きを復元しました。最後のステップからプレビューを開いて公開してください。
        </Alert>
      )}
      <QuotaStatusBanner
        quota={quotaState.quota}
        loading={quotaState.isLoading}
        onPurchaseTicket={() =>
          quotaState.startOneTimeCheckout({ ...(draftId ? { draftId } : {}), returnTo: nextPath })
        }
        onGranted={() => void quotaState.refreshQuota()}
        nextPath={nextPath}
      />
      {/*
        下書きの枠が空いていないことを、保存を試す前に 1 度だけ伝える。
        ボタンは止めない（保存できるかの正はサーバーの 403 で、Toast が受ける）。
        復元で来た人は既存の下書きを直すので、枠を見ない。
      */}
      {draftQuotaFull && (
        <Alert tone="warning">
          下書きが上限（{quotaState.quota?.draftEventLimit}件）です。下書き一覧で削除してください。{" "}
          <Link href="/organizer/events/drafts" className="text-link">
            下書き一覧を開く
          </Link>
        </Alert>
      )}
      <EventStepForm
        value={form}
        onChange={setForm}
        // 会員は下書き保存を経てプレビューへ進む。未登録はログインへ送る。
        onSubmit={() => void saveDraft(true)}
        submitting={savingDraft}
        savingDraft={savingDraft}
        canSaveDraft={signedIn}
        onSaveDraft={() => void saveDraft(false)}
        onRequireAuth={goAuth}
        actionsDisabled={quotaState.isLoading}
        disabled={restoring}
        ready={!restoring}
        seedKey={draftId ?? "new"}
        flyerPreviewUrl={flyerPreview}
        tour={{
          enabled: tourEnabled,
          signedIn,
          onClose: () => setTourClosed(true),
        }}
        flyerSlot={
          <>
            <FlyerGeneratePanel
              value={form}
              disabled={savingDraft || restoring}
              previewUrl={flyerPreview}
              flyerAssetId={form.flyerAssetId}
              draftScope="new"
              // 未ログインではチラシの作成も行き先が同じ認証。`goAuth` が入力を退避する。
              requireAuth={!signedIn}
              onRequireAuth={goAuth}
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
              className="btn btn--ghost btn--sm"
              disabled={savingDraft || restoring}
              onClick={() => setPickerOpen(true)}
            >
              過去のチラシから選ぶ
            </button>
            <FlyerSelectModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={applyFlyer} title={form.title} />
          </>
        }
        voiceSlot={(voiceApi) => (
          <VoiceInputDock
            value={form}
            onChange={setForm}
            api={voiceApi}
            disabled={savingDraft || restoring}
            guideDeferred={guideDeferred}
          />
        )}
      />
      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quota={quotaState.quota}
        context="create"
        onGranted={() => {
          setToastTone("success");
          setToast("0円チケットを受け取りました。「プレビューに進む」から公開できます。");
        }}
      />
      {toast && <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />}
    </div>
  );
}

export default function NewEventPage() {
  return (
    <Suspense
      fallback={
        <Loading>
          読み込んでいます
        </Loading>
      }
    >
      <NewEventScreen />
    </Suspense>
  );
}
