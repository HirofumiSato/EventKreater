import { composeEventTime, composeLocation, composePriceText } from "@/lib/serializers";
import type { EventFormValues, FlyerAsset } from "@/modules/events/types";

/**
 * 入力途中のフォームを、告知ページの部品（`PosterHero` / `EventMetaCard`）が
 * そのまま描ける形へ寄せる。モーダルのプレビューだけが使う。
 *
 * 未入力は空欄にせず「未入力」と出す。何が足りないかが、その場で分かるようにするため。
 * 保存はしないので、ID は行の `key` を使う（DB の値と混ぜない）。
 */
export interface EventFormPreview {
  title: string;
  schedules: { id: string; eventDate: string; startTime: string | null; endTime: string | null; eventTime: string }[];
  pricePlans: {
    id: string;
    name: string;
    audience: EventFormValues["pricePlans"][number]["audience"];
    amount: number;
    note: string | null;
    /** 表示用に合成した「3,000円（1ドリンク付）」。 */
    price: string;
  }[];
  location: string;
  rainPolicy: EventFormValues["rainPolicy"];
  capacity: number | null;
  targetGeneration: string | null;
  status: "DRAFT";
  rsvpDeadline: null;
  rsvpOpen: true;
  attendingCount: number;
  organizers: {
    owner: { name: string; userId: null };
    coHosts: { name: string; userId: null }[];
  };
  flyerAsset: FlyerAsset | null;
}

export function eventFormToPreview(
  value: EventFormValues,
  flyerPreviewUrl: string | null = null,
): EventFormPreview {
  const location = composeLocation(value) || "場所未定";
  return {
    title: value.title.trim() || "（催しの名前は未入力）",
    schedules: value.schedules.map((row) => ({
      id: row.key,
      eventDate: row.eventDate || "日付未定",
      startTime: row.startTime || null,
      endTime: row.endTime || null,
      eventTime: composeEventTime(row.startTime, row.endTime) || "時刻未入力",
    })),
    pricePlans: value.pricePlans.map((row) => {
      const amount = row.amount === "" ? 0 : Number(row.amount);
      return {
        id: row.key,
        name: row.name.trim() || "プラン名なし",
        audience: row.audience,
        amount,
        note: row.note.trim() || null,
        price: row.amount === "" ? "金額未入力" : composePriceText({ amount, note: row.note }),
      };
    }),
    location,
    rainPolicy: value.rainPolicy,
    capacity: value.capacity,
    targetGeneration: value.targetGeneration.trim() || null,
    status: "DRAFT",
    rsvpDeadline: null,
    rsvpOpen: true,
    attendingCount: 0,
    organizers: {
      owner: { name: value.organizerDisplayName.trim() || "主催者", userId: null },
      coHosts: [],
    },
    flyerAsset: flyerPreviewUrl
      ? {
          id: "preview",
          imageUrl: flyerPreviewUrl,
          lqipDataUrl: null,
          aspectRatio: "9:16",
        }
      : null,
  };
}
