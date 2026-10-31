/**
 * 公開中のイベントを、どの利用枠から公開したかで分ける。
 *
 * マイページの要約（`/mypage`）が「プラン公開」「チケット公開」を出すために使う。
 * 数え方は帯（`QuotaStatusBanner`）とサーバーの枠判定（`countPublishedSubscriptionEvents`）に
 * 揃える。公開済み・開催日が今日以降・自分の筆頭幹事のものだけを数え、月額プラン
 * （`SUBSCRIPTION`）と、それ以外（単発チケット・無料枠）に分ける。
 *
 * 開催日は `YYYY-MM-DD` の文字列のまま比べる（`Date` に戻すと時差で 1 日ずれる余地が生まれる）。
 */
import type { EventStatus, OrganizerRole, QuotaSource } from "@/modules/events/types";

export interface PublishedCounts {
  /** 月額プランから公開した件数。帯の「N / 8 件」と同じ数え方。 */
  plan: number;
  /** 単発チケットと無料枠から公開した件数。8 件の上限には数えない。 */
  ticket: number;
}

export interface PublishedCountRow {
  status: EventStatus;
  /** 見ている会員の、そのイベントでの役割。共同主催は数えない。 */
  role: OrganizerRole;
  quotaSource: QuotaSource | null;
  schedules: readonly { eventDate: string }[];
}

export function countPublishedBySource(
  rows: readonly PublishedCountRow[],
  today: string,
): PublishedCounts {
  const counts: PublishedCounts = { plan: 0, ticket: 0 };
  for (const row of rows) {
    if (row.status !== "PUBLISHED" || row.role !== "OWNER") continue;
    // 複数日程のどれかが今日以降なら、開催中として数える（サーバーの `some` と同じ）。
    if (!row.schedules.some((schedule) => schedule.eventDate >= today)) continue;
    if (row.quotaSource === "SUBSCRIPTION") counts.plan += 1;
    else counts.ticket += 1;
  }
  return counts;
}
