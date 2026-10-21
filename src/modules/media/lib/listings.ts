import { prisma } from "@/lib/prisma";
import { eventOptionsInclude } from "@/modules/events/lib/events";

/**
 * 将来のメディアサイト向けの掲載判定と一覧取得。
 *
 * いまのアプリはホームにイベント一覧を持たないため、HTTP ルートは公開していない。
 * メディアサイトを別サービスとして足すときに、この関数を内部 API から呼ぶ。
 * 掲載条件をここ 1 箇所に閉じ込め、イベント本体のライフサイクル（status）と混ぜない。
 */

export interface MediaListingQuery {
  q?: string;
  date?: string;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseListingQuery(input: MediaListingQuery): { q: string; date: string } {
  const q = (input.q ?? "").trim().slice(0, 100);
  const rawDate = (input.date ?? "").trim();
  const date = datePattern.test(rawDate) ? rawDate : "";
  return { q, date };
}

/** 掲載してよいイベントか。公開フラグとライフサイクルと削除をまとめて見る。 */
export function isListable(event: { status: string; visibility: string; isDeleted: boolean }): boolean {
  return !event.isDeleted && event.status === "PUBLISHED" && event.visibility === "PUBLIC";
}

export async function listListableEvents(input: MediaListingQuery) {
  const { q, date } = parseListingQuery(input);
  const where = {
    isDeleted: false,
    status: "PUBLISHED" as const,
    visibility: "PUBLIC" as const,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { location: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(date ? { schedules: { some: { eventDate: new Date(`${date}T00:00:00.000Z`) } } } : {}),
  };
  const [total, events] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: { sortDate: "asc" },
      take: 48,
      include: {
        flyerAsset: true,
        ...eventOptionsInclude,
        participants: { where: { status: "ATTENDING" }, select: { id: true } },
      },
    }),
  ]);
  return { q, date, total, events };
}
