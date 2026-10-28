"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  type EventStepKey,
} from "@/modules/events/lib/steps";
import {
  BasicSection,
  CapacitySection,
  LocationSection,
  PricePlansSection,
  ThemeSection,
} from "@/modules/events/components/EventFormSections";
import { EventPreviewModal } from "@/modules/events/components/EventPreviewModal";
import { Alert } from "@/components/ui";

interface EventStepFormProps {
  value: EventFormValues;
  onChange: (value: EventFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled?: boolean;
  /** 未登録の幹事にだけ、公開ページへ出す主催者名を聞く。 */
  showOrganizerName?: boolean;
  /**
   * 会員だけが下書きを保存できる。true のとき、最終ステップに
   * 「下書き保存」と「プレビューを見る」を並べる。false は未登録として
   * 「ログインして下書き保存する」「ログインして公開する」の 2 択を出す。
   */
  canSaveDraft?: boolean;
  onSaveDraft?: () => void;
  savingDraft?: boolean;
  /**
   * 未登録の幹事には、公開の代わりに「ログインして下書き保存」「ログインして公開」の
   * 2 択を出す。どちらもここまでの入力を確かめて退避してから認証画面へ送る。
   * 認証画面は新規登録とログインを 1 枚で扱うので、遷移先は同じでよい。
   */
  onRequireAuth?: () => void;
  /** 利用枠の読み込み中など、最終操作のボタンだけを止めたいとき。入力欄は止めない。 */
  actionsDisabled?: boolean;
  /** チラシ生成のパネル。最終ステップに出す。 */
  flyerSlot: ReactNode;
  /** 作成中のチラシの画像 URL。モーダルのプレビューに使う。 */
  flyerPreviewUrl?: string | null;
  /**
   * 音声入力のパネル。フォームの末尾に出す。画面では右下に固定表示する。
   * ステップを開く操作を渡すため、`flyerSlot` と違って関数で受け取る。
   */
  voiceSlot?: (api: VoiceStepApi) => ReactNode;
  /**
   * 開くステップを決め直す単位。下書きを復元したら `draftId`、新規なら "new"。
   * 値の読み込みが終わってから `ready` を true にすると、最初の未完了ステップを開く。
   */
  seedKey: string;
  ready: boolean;
}

const STEP_INDEX = new Map(EVENT_STEPS.map((step, index) => [step.key, index]));

/**
 * 音声入力からステップを操作するための入口。
 * 音声は「見た目だけのフォーカス」で進むため、見出しボタンへ実フォーカスを移さない。
 */
export interface VoiceStepApi {
  /** ステップを開く。すでに開いていれば何もしない。 */
  openStep: (key: EventStepKey) => void;
  /** 画面の読み上げに流す。 */
  announce: (message: string) => void;
}

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
  canSaveDraft = false,
  onSaveDraft,
  savingDraft = false,
  onRequireAuth,
  actionsDisabled = false,
  flyerSlot,
  flyerPreviewUrl = null,
  voiceSlot,
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
  /** モーダルのプレビュー。スマホの最終操作と、テーマ選択の導線から開く。 */
  const [previewOpen, setPreviewOpen] = useState(false);
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

  /**
   * 音声入力用にステップを開く。見出しボタンへ実フォーカスを移さない。
   * 実フォーカスを移すと、日付・時刻の入力欄で OS のピッカーが開き、マイクを止めてしまう。
   */
  const voiceApi = useMemo<VoiceStepApi>(
    () => ({
      openStep: (key) => {
        setOpenKeys((current) => {
          if (current.has(key)) return current;
          const next = new Set(current);
          next.add(key);
          return next;
        });
      },
      announce: setAnnouncement,
    }),
    [],
  );

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

  /** 必須のステップが埋まっているか確かめる。下書き保存とプレビューの両方で使う。 */
  const validate = (): boolean => {
    setError(null);
    const blocked = EVENT_STEPS.find((step) => step.mandatory && !isComplete(step.key));
    if (blocked) {
      setError(`「${blocked.title}」の入力を終えてから保存してください。`);
      openStep(blocked.key);
      return false;
    }
    // 定員は任意だが、「51以上」を選んで空のまま保存すると無制限として保存されてしまう。
    if (!isCapacityStepComplete(value.capacity, capacitySelection)) {
      setError("定員の人数を入れるか、「無制限」を選んでください。");
      openStep("capacity");
      return false;
    }
    return true;
  };

  const submit = () => {
    if (!validate()) return;
    onSubmit();
  };

  const saveDraft = () => {
    if (!onSaveDraft) return;
    if (!validate()) return;
    onSaveDraft();
  };

  /** スマホか。プレビューをモーダルにするかどうかの分岐にだけ使う。 */
  const isNarrow = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

  /**
   * 最終操作の「プレビューを見る」。
   * スマホはその場のモーダルで確かめ、広い画面は従来どおり SCR-ORG-16 へ進む。
   */
  const preview = () => {
    if (!validate()) return;
    if (isNarrow()) {
      setPreviewOpen(true);
      return;
    }
    onSubmit();
  };

  /**
   * 未登録の幹事の最終操作。ログインの前にここまでの入力を確かめ、
   * 未入力があればそのステップを開く（「次へ」で進めないのと同じ扱い）。
   */
  const requireAuth = () => {
    if (!validate()) return;
    onRequireAuth?.();
  };

  const nextDisabled = (key: EventStepKey) => {
    if (key === "basic") return !isBasicStepComplete(value);
    if (key === "pricing") return !isPricingStepComplete(value);
    if (key === "location") return !isLocationStepComplete(value);
    if (key === "capacity") return !isCapacityStepComplete(value.capacity, capacitySelection);
    return false;
  };

  const requiredSteps = EVENT_STEPS.filter((step) => step.mandatory);
  const requiredDone = requiredSteps.filter((step) => isComplete(step.key)).length;
  const requiredRemaining = requiredSteps.length - requiredDone;

  return (
    <div className="stack">
      {/* 進み具合は必須ステップぶんのドットだけで見せる。文字を並べると、
          ステップ数の見出しと数が食い違って読みにくい。残りは読み上げにだけ流す。 */}
      <div className="progress-card">
        <p className="visually-hidden">
          {requiredRemaining === 0
            ? "必須の入力はそろいました。"
            : `必須の入力はあと ${requiredRemaining} つです。`}
        </p>
        <div className="progress-dots" aria-hidden="true">
          {requiredSteps.map((step) => (
            <span
              key={step.key}
              className={[
                "progress-dots__dot",
                openKeys.has(step.key) ? "is-current" : "",
                isComplete(step.key) ? "is-done" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </div>
      </div>

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
      {error && <Alert tone="error">{error}</Alert>}
      <ol className="event-steps__list">
        {EVENT_STEPS.map((step, index) => {
          const open = openKeys.has(step.key);
          const complete = isComplete(step.key);
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
                      {step.mandatory ? <span className="event-step__req">必須</span> : null}
                    </span>
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
                  {step.key === "flyer" && (
                    <>
                      <ThemeSection
                        value={value}
                        onChange={onChange}
                        disabled={locked}
                        onPreview={() => setPreviewOpen(true)}
                      />
                      {flyerSlot}
                    </>
                  )}
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
                    {step.key !== "flyer" && (
                      <button
                        type="button"
                        className="btn btn--primary event-step__next"
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
      {/* 最後の操作はステップの中に入れない。閉じたステップに隠れると、
          どこを開けば保存・公開できるのか分からなくなる。 */}
      <div className={`form-final${canSaveDraft ? "" : " form-final--guest"}`}>
        <p className="form-final__note">
          {requiredRemaining === 0 ? (
            "必須の入力はそろいました。"
          ) : (
            <>
              必須の入力はあと <strong>{requiredRemaining}</strong> つです。
            </>
          )}
        </p>
        <div className="form-final__actions">
          {canSaveDraft ? (
            <>
              <button
                type="button"
                className="btn btn--outline"
                disabled={locked}
                onClick={saveDraft}
              >
                {savingDraft ? "保存中..." : "下書き保存"}
              </button>
              <button type="button" className="btn btn--primary" disabled={locked} onClick={preview}>
                {submitting ? "移動中..." : "プレビューを見る"}
              </button>
            </>
          ) : (
            <>
              {/* 未登録でも、ログイン後と同じ 2 つの位置に置く。戻ってきたときに
                  帯の形が変わらず、押す場所を覚え直さずに済む。 */}
              <button
                type="button"
                className="btn btn--outline"
                disabled={locked || actionsDisabled}
                onClick={requireAuth}
              >
                ログインして下書き保存する
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={locked || actionsDisabled}
                onClick={requireAuth}
              >
                ログインして公開する
              </button>
            </>
          )}
        </div>
      </div>
      {voiceSlot?.(voiceApi)}
    </form>
    {/* モーダルはフォームの外に置く。ステップの送信や無効化に巻き込まない。 */}
    {previewOpen && (
      <EventPreviewModal
        value={value}
        flyerPreviewUrl={flyerPreviewUrl}
        onClose={() => setPreviewOpen(false)}
        onContinue={
          canSaveDraft
            ? () => {
                // テーマ選択の導線からは検証せずに開ける。進む前にここで 1 回だけ確かめる。
                setPreviewOpen(false);
                if (!validate()) return;
                onSubmit();
              }
            : null
        }
        continuing={submitting}
      />
    )}
    </div>
  );
}
