import {
  composeEventTime,
  flyerLocationLabel,
  flyerPriceLabel,
} from "@/lib/serializers";
import type { SemanticThemeId } from "@/lib/semantic-themes";
import type { EventFormValues } from "@/modules/events/types";

/** チラシ生成サービスへ渡す 9 項目（題・日時・費用・場所・雨天・定員・テーマ・対象世代）。ウィザードの全ステップで同じ値を使う。 */
export interface FlyerFormPayload {
  title: string;
  eventDate: string;
  eventTime: string;
  price: string;
  location: string;
  rainPolicy: EventFormValues["rainPolicy"];
  capacity: number | null;
  /**
   * 告知ページで選んだセマンティックテーマ。
   * チラシの画像生成にも渡し、背景の雰囲気をページと揃える。null は標準。
   */
  themeId: SemanticThemeId | null;
  /**
   * 想定する参加者の世代（例: 20代から40代）。
   * 背景の人物像と光の当て方を寄せるためにサービスへ渡す。null は指定なし。
   */
  targetGeneration: string | null;
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
    themeId: value.themeId,
    targetGeneration: value.targetGeneration.trim() || null,
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
    return "先にイベント名を入れてください。";
  }
  return null;
}
