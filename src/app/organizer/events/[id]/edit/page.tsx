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
import { readProblem } from "@/lib/problem";
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
      setToast(cause instanceof Error ? cause.message : "保存に失敗しました");
      setSaving(false);
    }
  };

  const applyFlyer = (flyer: SelectableFlyer) => {
    setForm((current) => applyFlyerToForm(current, flyer));
    setFlyerPreview(flyer.imageUrl);
  };

  if (error) return <p className="alert alert--error">{error}</p>;
  if (!ready) {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        編集画面を準備しています
      </p>
    );
  }

  return (
    <div className="page--form stack">
      <section className="panel">
        <div>
          <h1 className="page-title">イベント編集</h1>
          {form.title ? <p className="page-lead">{form.title}</p> : null}
        </div>
        <Link href="/organizer/events" className="btn btn--ghost">
          一覧へ戻る
        </Link>
      </section>
      {lock.status === "acquiring" && (
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          編集を開始しています
        </p>
      )}
      {lock.error && <p className="alert alert--error">{lock.error}</p>}
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
              draftScope={`event:${params.id}`}
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
            <FlyerSelectModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={applyFlyer} />
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
      {toast && <Toast message={toast} tone={toast === "保存しました" ? "success" : "error"} onClose={() => setToast(null)} />}
    </div>
  );
}
