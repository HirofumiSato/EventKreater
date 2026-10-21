import {
  composeEventTime,
  flyerLocationLabel,
  flyerPriceLabel,
} from "@/lib/serializers";
import type { EventFormValues } from "@/modules/events/types";

/** チラシ生成サービスへ渡す 7 項目。ウィザードの全ステップで同じ値を使う。 */
export interface FlyerFormPayload {
  title: string;
  eventDate: string;
  eventTime: string;
  price: string;
  location: string;
  rainPolicy: EventFormValues["rainPolicy"];
  capacity: number | null;
}

export function buildFlyerFormPayload(value: EventFormValues): FlyerFormPayload {
  return {
    title: value.title,
    eventDate: value.schedules[0]?.eventDate ?? "",
    eventTime: composeEventTime(
      value.schedules[0]?.startTime,
      value.schedules[0]?.endTime,
    ),
    // 男女別の料金は 30 文字に収まる範囲で「男性3,000円 / 女性2,500円」と並べる。
    price: flyerPriceLabel(
      value.pricePlans.map((row) => ({
        name: row.name,
        audience: row.audience,
        amount: Number(row.amount || 0),
        note: row.note,
      })),
    ),
    location: flyerLocationLabel(value),
    rainPolicy: value.rainPolicy,
    capacity: value.capacity,
  };
}

/** チラシに描けない状態なら、先に直すべきことを 1 文で返す。 */
export function validateFlyerForm(value: EventFormValues): string | null {
  const first = value.schedules[0];
  if (!first?.startTime || !first.endTime) {
    return "先に開催日の開始・終了時刻を入れてください。";
  }
  if (value.pricePlans.some((row) => row.amount === "")) {
    return "先に費用プランの金額を入れてください。";
  }
  if (!value.title.trim()) {
    return "先に催しの名前を入れてください。";
  }
  return null;
}
