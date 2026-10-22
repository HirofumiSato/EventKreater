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
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <BasicSection
        value={value}
        onChange={onChange}
        disabled={locked}
        showOrganizerName={showOrganizerName}
      />
      <PricePlansSection
        value={value}
        onChange={onChange}
        disabled={locked}
        pricingModeLocked={pricingModeLocked}
      />
      <LocationSection value={value} onChange={onChange} disabled={locked} />
      <CapacitySection
        value={value}
        onChange={onChange}
        disabled={locked}
        selection={capacitySelection}
        onSelectionChange={(next) => setCustomCapacity(next === "custom")}
      />
      {flyerSlot}
      {showStatus && <StatusSection value={value} onChange={onChange} disabled={locked} />}
      <button type="submit" disabled={locked} className="btn btn--primary btn--block">
        {submitting ? "送信中..." : submitLabel}
      </button>
    </form>
  );
}
