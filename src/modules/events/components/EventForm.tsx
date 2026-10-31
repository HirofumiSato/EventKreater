"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { EventFormValues } from "@/modules/events/types";
import { capacitySelectionOf, type CapacitySelection } from "@/modules/events/lib/capacity";
import { eventStep, type EventStep } from "@/modules/events/lib/steps";
import {
  BasicSection,
  CapacitySection,
  LocationSection,
  PricePlansSection,
  StatusSection,
  ThemeSection,
} from "@/modules/events/components/EventFormSections";

/** 編集画面だけが出す 6 段目。新規作成の 5 段には無いので `EVENT_STEPS` には入れない。 */
const STATUS_STEP = {
  title: "公開状態",
  hint: "止めるときは主催一覧の「停止」から。",
  mandatory: false,
} as const;

interface EventFormProps {
  value: EventFormValues;
  onChange: (value: EventFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled?: boolean;
  submitLabel: string;
  showStatus?: boolean;
  /** 出席者がいるため、共通／男女別の切り替えを止める。 */
  pricingModeLocked?: boolean;
  /** 未登録の幹事にだけ、公開ページへ出す主催者名を聞く。 */
  showOrganizerName?: boolean;
  flyerSlot?: ReactNode;
}

/**
 * 編集画面の一括フォーム。すべての入力を 1 枚に並べる。
 * 新規作成は `EventStepForm` を使い、同じセクションをステップに分けて出す。
 */
export function EventForm({
  value,
  onChange,
  onSubmit,
  submitting,
  disabled = false,
  submitLabel,
  showStatus = false,
  pricingModeLocked = false,
  showOrganizerName = false,
  flyerSlot,
}: EventFormProps) {
  const locked = disabled || submitting;
  // 「51以上」を選んだことは保存値から分からない（空にすると無制限と同じになる）ので、画面側で覚える。
  const [customCapacity, setCustomCapacity] = useState(false);
  const capacitySelection: CapacitySelection = customCapacity
    ? "custom"
    : capacitySelectionOf(value.capacity);

  return (
    <form
      className="form event-steps"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <ol className="event-steps__list">
        <EventStepFrame number={1} step={eventStep("basic")}>
          <BasicSection
            value={value}
            onChange={onChange}
            disabled={locked}
            showOrganizerName={showOrganizerName}
          />
        </EventStepFrame>
        <EventStepFrame number={2} step={eventStep("pricing")}>
          <PricePlansSection
            value={value}
            onChange={onChange}
            disabled={locked}
            pricingModeLocked={pricingModeLocked}
          />
        </EventStepFrame>
        <EventStepFrame number={3} step={eventStep("location")}>
          <LocationSection value={value} onChange={onChange} disabled={locked} />
        </EventStepFrame>
        <EventStepFrame number={4} step={eventStep("capacity")}>
          <CapacitySection
            value={value}
            onChange={onChange}
            disabled={locked}
            selection={capacitySelection}
            onSelectionChange={(next) => setCustomCapacity(next === "custom")}
          />
        </EventStepFrame>
        <EventStepFrame number={5} step={eventStep("flyer")}>
          <ThemeSection value={value} onChange={onChange} disabled={locked} />
          {flyerSlot}
        </EventStepFrame>
        {showStatus && (
          <EventStepFrame number={6} step={STATUS_STEP}>
            <StatusSection value={value} onChange={onChange} disabled={locked} />
          </EventStepFrame>
        )}
      </ol>
      <button type="submit" disabled={locked} className="btn btn--primary btn--block">
        {submitting ? "保存しています…" : submitLabel}
      </button>
    </form>
  );
}

/** 編集画面の各入力を、新規作成と同じ「ステップ」の見た目で並べる。折りたたみはしない。 */
function EventStepFrame({
  number,
  step,
  children,
}: {
  number: number;
  /** 見出しと補足は `EVENT_STEPS` から渡す。ここに文言を書き戻さない。 */
  step: Pick<EventStep, "title" | "hint" | "mandatory">;
  children: ReactNode;
}) {
  return (
    <li className="event-step event-step--open">
      <h2 className="event-step__heading">
        <div className="event-step__toggle event-step__toggle--static">
          <span className="event-step__number" aria-hidden="true">
            {number}
          </span>
          <span className="event-step__labels">
            <span className="event-step__title">
              {step.title}
              {step.mandatory ? <span className="req"> *</span> : null}
            </span>
            <span className="event-step__summary">{step.hint}</span>
          </span>
          <span className="event-step__state">{step.mandatory ? "必須" : "任意"}</span>
        </div>
      </h2>
      <div className="event-step__body">{children}</div>
    </li>
  );
}
