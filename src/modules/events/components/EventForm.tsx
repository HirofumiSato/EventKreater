"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { EventFormValues } from "@/modules/events/types";
import { capacitySelectionOf, type CapacitySelection } from "@/modules/events/lib/capacity";
import {
  BasicSection,
  CapacitySection,
  LocationSection,
  PricePlansSection,
  StatusSection,
  ThemeSection,
} from "@/modules/events/components/EventFormSections";

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
        <EventStepFrame number={1} title="催しの名前と開催日時" hint="何をいつ開くか。チラシにも告知ページにも出ます。" required>
          <BasicSection
            value={value}
            onChange={onChange}
            disabled={locked}
            showOrganizerName={showOrganizerName}
          />
        </EventStepFrame>
        <EventStepFrame number={2} title="費用プラン" hint="参加者が選ぶ金額です。あとから追加できます。" required>
          <PricePlansSection
            value={value}
            onChange={onChange}
            disabled={locked}
            pricingModeLocked={pricingModeLocked}
          />
        </EventStepFrame>
        <EventStepFrame number={3} title="開催場所" hint="会場名だけでも保存できます。雨天時の方針もここで決めます。" required>
          <LocationSection value={value} onChange={onChange} disabled={locked} />
        </EventStepFrame>
        <EventStepFrame number={4} title="定員と申し込み期限" hint="どちらも任意です。空欄なら制限なしで受け付けます。">
          <CapacitySection
            value={value}
            onChange={onChange}
            disabled={locked}
            selection={capacitySelection}
            onSelectionChange={(next) => setCustomCapacity(next === "custom")}
          />
        </EventStepFrame>
        <EventStepFrame
          number={5}
          title="イベントページテーマ選択&チラシ生成"
          hint="テーマは告知ページの見た目と、チラシの雰囲気に効きます。チラシは作らなくても保存できます。"
        >
          <ThemeSection value={value} onChange={onChange} disabled={locked} />
          {flyerSlot}
        </EventStepFrame>
        {showStatus && (
          <EventStepFrame number={6} title="公開状態" hint="受付を止めるときは主催一覧の「削除・停止」から行います。">
            <StatusSection value={value} onChange={onChange} disabled={locked} />
          </EventStepFrame>
        )}
      </ol>
      <button type="submit" disabled={locked} className="btn btn--primary btn--block">
        {submitting ? "送信中..." : submitLabel}
      </button>
    </form>
  );
}

/** 編集画面の各入力を、新規作成と同じ「ステップ」の見た目で並べる。折りたたみはしない。 */
function EventStepFrame({
  number,
  title,
  hint,
  required = false,
  children,
}: {
  number: number;
  title: string;
  hint: string;
  required?: boolean;
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
              {title}
              {required ? <span className="req"> *</span> : null}
            </span>
            <span className="event-step__summary">{hint}</span>
          </span>
          <span className="event-step__state">{required ? "必須" : "任意"}</span>
        </div>
      </h2>
      <div className="event-step__body">{children}</div>
    </li>
  );
}
