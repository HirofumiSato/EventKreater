"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { EventFormValues } from "@/modules/events/types";
import {
  capacitySelectionOf,
  type CapacitySelection,
} from "@/modules/events/lib/capacity";
import {
  EVENT_STEPS,
  isBasicStepComplete,
  isCapacityStepComplete,
  isLocationStepComplete,
  isPricingStepComplete,
  isStepComplete,
  resumeStepKey,
  summarizeStep,
  type EventStepKey,
} from "@/modules/events/lib/steps";
import {
  BasicSection,
  CapacitySection,
  LocationSection,
  PricePlansSection,
} from "@/modules/events/components/EventFormSections";

interface EventStepFormProps {
  value: EventFormValues;
  onChange: (value: EventFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled?: boolean;
  /** 未登録の幹事にだけ、公開ページへ出す主催者名を聞く。 */
  showOrganizerName?: boolean;
  /** チラシ生成のパネル。最終ステップに出す。 */
  flyerSlot: ReactNode;
  /**
   * 開くステップを決め直す単位。下書きを復元したら `draftId`、新規なら "new"。
   * 値の読み込みが終わってから `ready` を true にすると、最初の未完了ステップを開く。
   */
  seedKey: string;
  ready: boolean;
}

const STEP_INDEX = new Map(EVENT_STEPS.map((step, index) => [step.key, index]));

function isForward(from: EventStepKey | null, to: EventStepKey | null): boolean {
  const fromIndex = from === null ? EVENT_STEPS.length : (STEP_INDEX.get(from) ?? 0);
  const toIndex = to === null ? EVENT_STEPS.length : (STEP_INDEX.get(to) ?? 0);
  return toIndex > fromIndex;
}

/**
 * 新規イベント作成のステップ入力。
 * 入力項目は減らさず、開いているステップの入力欄だけを出す。
 * 必須のステップが埋まったら次を開き、済んだステップは要約 1 行に畳む。
 */
export function EventStepForm({
  value,
  onChange,
  onSubmit,
  submitting,
  disabled = false,
  showOrganizerName = false,
  flyerSlot,
  seedKey,
  ready,
}: EventStepFormProps) {
  const locked = disabled || submitting;
  const [openKeys, setOpenKeys] = useState<Set<EventStepKey>>(
    () => new Set<EventStepKey>(["basic"]),
  );
  const [customCapacity, setCustomCapacity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const capacitySelection: CapacitySelection = customCapacity
    ? "custom"
    : capacitySelectionOf(value.capacity);

  // 復元した値が入ってから、続きのステップを開く。値が変わっても開き直さない。
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || seeded.current === seedKey) return;
    seeded.current = seedKey;
    setOpenKeys(new Set([resumeStepKey(value)]));
    setCustomCapacity(capacitySelectionOf(value.capacity) === "custom");
  }, [ready, seedKey, value]);

  // 必須のステップが埋まったら、次の必須ステップを開いて今のステップを畳む。
  // 任意のステップは自動で開かない。過去のステップを直したときも後ろを動かさない。
  const frontier = (() => {
    const first = EVENT_STEPS.find(
      (step) =>
        step.mandatory &&
        !isStepComplete(step.key, value, { capacitySelection, flyerSkipped: false }),
    );
    return first?.key ?? null;
  })();
  const previousFrontier = useRef<EventStepKey | null>(frontier);
  useEffect(() => {
    const before = previousFrontier.current;
    previousFrontier.current = frontier;
    if (before === null || before === frontier || !isForward(before, frontier)) return;
    const nextStep = EVENT_STEPS[(STEP_INDEX.get(before) ?? 0) + 1];
    if (!nextStep?.mandatory) return;
    setOpenKeys((current) => {
      if (!current.has(before)) return current;
      const next = new Set(current);
      next.delete(before);
      next.add(nextStep.key);
      return next;
    });
    setAnnouncement(`「${nextStep.title}」に進みました。`);
  }, [frontier]);

  // 開いたステップの見出しへフォーカスを移す。押した場所を見失わないようにする。
  const pendingFocus = useRef<EventStepKey | null>(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = document.getElementById(`event-step-${pendingFocus.current}-toggle`);
    pendingFocus.current = null;
    target?.focus();
  });

  const openStep = (key: EventStepKey) => {
    pendingFocus.current = key;
    setOpenKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      next.add(key);
      return next;
    });
  };

  const toggleStep = (key: EventStepKey) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const closeStep = (key: EventStepKey) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const goNext = (key: EventStepKey) => {
    const next = EVENT_STEPS[(STEP_INDEX.get(key) ?? 0) + 1];
    if (!next) return;
    closeStep(key);
    openStep(next.key);
  };

  const goBack = (key: EventStepKey) => {
    const previous = EVENT_STEPS[(STEP_INDEX.get(key) ?? 0) - 1];
    if (!previous) return;
    closeStep(key);
    openStep(previous.key);
  };

  const isComplete = (key: EventStepKey) =>
    isStepComplete(key, value, { capacitySelection, flyerSkipped: false });

  const submit = () => {
    setError(null);
    const blocked = EVENT_STEPS.find((step) => step.mandatory && !isComplete(step.key));
    if (blocked) {
      setError(`「${blocked.title}」の入力を終えてから公開してください。`);
      openStep(blocked.key);
      return;
    }
    if (!isCapacityStepComplete(value.capacity, capacitySelection)) {
      setError("定員の人数を入れるか、「無制限」を選んでください。");
      openStep("capacity");
      return;
    }
    onSubmit();
  };

  const nextDisabled = (key: EventStepKey) => {
    if (key === "basic") return !isBasicStepComplete(value);
    if (key === "pricing") return !isPricingStepComplete(value);
    if (key === "location") return !isLocationStepComplete(value);
    if (key === "capacity") return !isCapacityStepComplete(value.capacity, capacitySelection);
    return false;
  };

  return (
    <form
      className="form event-steps"
      noValidate
      onKeyDown={(event) => {
        // 入力中の Enter で公開まで進まないようにする。進むのはボタンで行う。
        if (event.key !== "Enter") return;
        const tag = (event.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "SELECT") event.preventDefault();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {error && <p className="alert alert--error">{error}</p>}
      <ol className="event-steps__list">
        {EVENT_STEPS.map((step, index) => {
          const open = openKeys.has(step.key);
          const complete = isComplete(step.key);
          const summary = summarizeStep(step.key, value);
          // 任意のステップは、入っていても「任意」と出す。必須だけ完了・未完了を出す。
          const stateLabel = step.mandatory ? (complete ? "入力済み" : "未入力") : "任意";
          return (
            <li
              key={step.key}
              className={[
                "event-step",
                open ? "event-step--open" : "",
                // 完了の印は必須ステップだけに付ける。任意は空でも「次へ」進めるため。
                step.mandatory && complete ? "event-step--done" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <h2 className="event-step__heading">
                <button
                  type="button"
                  id={`event-step-${step.key}-toggle`}
                  className="event-step__toggle"
                  aria-expanded={open}
                  aria-controls={`event-step-${step.key}`}
                  onClick={() => toggleStep(step.key)}
                >
                  <span className="event-step__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="event-step__labels">
                    <span className="event-step__title">
                      {step.title}
                      {step.mandatory ? <span className="req"> *</span> : null}
                    </span>
                    <span className="event-step__summary">{open ? step.hint : (summary ?? step.hint)}</span>
                  </span>
                  <span className="event-step__state">{stateLabel}</span>
                </button>
              </h2>
              {open && (
                <div
                  id={`event-step-${step.key}`}
                  className="event-step__body"
                  role="group"
                  aria-labelledby={`event-step-${step.key}-toggle`}
                >
                  {step.key === "basic" && (
                    <BasicSection
                      value={value}
                      onChange={onChange}
                      disabled={locked}
                      showOrganizerName={showOrganizerName}
                    />
                  )}
                  {step.key === "pricing" && (
                    <PricePlansSection value={value} onChange={onChange} disabled={locked} />
                  )}
                  {step.key === "location" && (
                    <LocationSection value={value} onChange={onChange} disabled={locked} />
                  )}
                  {step.key === "capacity" && (
                    <CapacitySection
                      value={value}
                      onChange={onChange}
                      disabled={locked}
                      selection={capacitySelection}
                      onSelectionChange={(next) => setCustomCapacity(next === "custom")}
                    />
                  )}
                  {step.key === "flyer" && flyerSlot}
                  <div className="event-step__actions">
                    {index > 0 && (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={locked}
                        onClick={() => goBack(step.key)}
                      >
                        戻る
                      </button>
                    )}
                    {step.key === "flyer" ? (
                      <button
                        type="submit"
                        className="btn btn--primary"
                        disabled={locked}
                      >
                        {submitting
                          ? "送信中..."
                          : value.flyerAssetId
                            ? "公開する"
                            : "チラシなしで公開する"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--outline"
                        disabled={locked || nextDisabled(step.key)}
                        onClick={() => goNext(step.key)}
                      >
                        次へ
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </form>
  );
}
