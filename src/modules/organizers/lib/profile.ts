import type { EventStatus } from "@/modules/events/types";
import {
  PROFILE_LINK_LABELS,
  PROFILE_TAGS,
  type OrganizerProfileContent,
  type OrganizerProfileDraft,
  type OrganizerProfileLink,
  type OrganizerProfileStats,
  type ProfileTag,
} from "@/modules/organizers/types";

/**
 * 主催者の公開プロフィールの、DB も Next.js も触らない部分。
 *
 * 表示の組み立てと入力の検査をここへ寄せ、API・画面・テストで同じ判定を使う。
 * 日付は `YYYY-MM-DD` の文字列で比べる（`src/lib/calendar.ts` と同じ扱い）。
 */

type ProfileUrlKey = "xUrl" | "instagramUrl" | "websiteUrl" | "lineUrl";

/**
 * 公開ページに出すリンクの並びと、許可するホスト。
 * Webサイトと LINE は DB に残すが、公開ページと編集画面には出さない。
 */
const LINK_RULES: { kind: OrganizerProfileLink["kind"]; key: ProfileUrlKey; hosts: string[] }[] = [
  { kind: "X", key: "xUrl", hosts: ["x.com", "twitter.com"] },
  { kind: "INSTAGRAM", key: "instagramUrl", hosts: ["instagram.com"] },
];

/** 保存されている値が固定リストのどれか。壊れた値は落とす。 */
export function isProfileTag(value: string): value is ProfileTag {
  return (PROFILE_TAGS as readonly string[]).includes(value);
}

/** DB の文字列配列を、画面で使えるジャンルだけに絞る。 */
export function normalizeProfileTags(values: readonly string[] | null | undefined): ProfileTag[] {
  if (!values) return [];
  const kept: ProfileTag[] = [];
  for (const value of values) {
    if (!isProfileTag(value) || kept.includes(value)) continue;
    kept.push(value);
  }
  return kept;
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** 入力された URL を、並び順どおりのリンクへ変える。未入力は飛ばす。 */
export function profileLinks(source: Pick<OrganizerProfileDraft, "xUrl" | "instagramUrl" | "websiteUrl" | "lineUrl">): OrganizerProfileLink[] {
  const links: OrganizerProfileLink[] = [];
  for (const rule of LINK_RULES) {
    const url = present(source[rule.key]);
    if (!url) continue;
    links.push({ kind: rule.kind, label: PROFILE_LINK_LABELS[rule.kind], url });
  }
  return links;
}

/** URL が入力規則を満たすか。満たせば null、駄目なら画面に出す理由を返す。 */
export function profileUrlProblem(value: string, hosts: readonly string[], label: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${label}は https:// から始まるURLを入力してください。`;
  }
  if (url.protocol !== "https:") {
    return `${label}は https:// から始まるURLを入力してください。`;
  }
  if (url.username || url.password) {
    return `${label}にユーザー名やパスワードは入れられません。`;
  }
  if (hosts.length > 0 && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return `${label}は ${hosts.join(" / ")} のURLを入力してください。`;
  }
  return null;
}

/** 入力中の下書きを、公開ページと同じ形に組み立てる。プレビューで使う。 */
export function profileContentFromDraft(
  draft: OrganizerProfileDraft,
  stats: OrganizerProfileStats | null,
  avatarUrl: string | null = null,
): OrganizerProfileContent {
  return {
    isPublished: draft.isPublished,
    headline: present(draft.headline),
    bio: present(draft.bio),
    area: present(draft.area),
    tags: draft.tags,
    links: profileLinks(draft),
    stats: draft.showStats ? stats : null,
    avatarUrl,
    themeId: draft.themeId,
  };
}

/** 自己紹介・リンク・実績を出してよいか。行が無い会員は非公開として扱う。 */
export function profileIsPublished(profile: { isPublished: boolean } | null | undefined): boolean {
  return Boolean(profile?.isPublished);
}

export interface ProfileStatSource {
  status: EventStatus;
  isDeleted: boolean;
  schedules: { eventDate: string }[];
}

/**
 * 開催済みの催しから「主催 N回・YYYY年から」を出す。
 *
 * 下書き・削除済み・今日以降だけの催しは数えない。
 * 共同主催として入っている催しも、その人が主催に加わった催しとして数える。
 */
export function profileStats(
  events: readonly ProfileStatSource[],
  today: string,
): OrganizerProfileStats | null {
  const held = events.filter(
    (event) =>
      !event.isDeleted &&
      event.status !== "DRAFT" &&
      event.schedules.some((schedule) => schedule.eventDate <= today),
  );
  if (held.length === 0) return null;
  const dates = held
    .flatMap((event) => event.schedules.map((schedule) => schedule.eventDate))
    .filter((date) => date <= today)
    .sort();
  const earliest = dates[0];
  if (!earliest) return null;
  return { eventCount: held.length, sinceYear: Number(earliest.slice(0, 4)) };
}

/** メタ情報用。改行を空白にし、指定の長さで切る。 */
export function profileBioExcerpt(bio: string | null | undefined, max = 120): string | null {
  const flat = bio?.replace(/\s+/g, " ").trim() ?? "";
  if (flat === "") return null;
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

/** 主催者名の頭文字。モノグラムに使う。 */
export function profileInitial(name: string): string {
  return name.trim().slice(0, 1) || "主";
}
