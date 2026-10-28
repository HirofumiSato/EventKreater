import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { formatEventDate } from "@/lib/serializers";
import { todayInTokyo } from "@/lib/calendar";
import { imageAssetImagePath } from "@/lib/image-assets";
import { normalizeSemanticThemeId } from "@/lib/semantic-themes";
import {
  normalizeProfileTags,
  profileLinks,
  profileStats,
  type ProfileStatSource,
} from "@/modules/organizers/lib/profile";
import {
  EMPTY_PROFILE_DRAFT,
  type OrganizerProfileContent,
  type OrganizerProfileDraft,
  type OrganizerProfileStats,
  type ProfileTag,
} from "@/modules/organizers/types";

/**
 * 主催者の公開プロフィールの読み書き。
 *
 * 公開ページはサーバーコンポーネントからこのファイルを直接呼ぶ。
 * 行が無い会員は「未作成」として扱い、既定値（非公開・空）を返す。
 */

export interface OrganizerProfileInput {
  isPublished: boolean;
  headline: string | null;
  bio: string | null;
  area: string | null;
  tags: ProfileTag[];
  xUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  lineUrl: string | null;
  showStats: boolean;
  themeId: string | null;
}

export interface LoadedOrganizerProfile {
  userId: string;
  name: string;
  profile: OrganizerProfileContent;
}

function emptyContent(): OrganizerProfileContent {
  return {
    isPublished: false,
    headline: null,
    bio: null,
    area: null,
    tags: [],
    links: [],
    stats: null,
    avatarUrl: null,
    themeId: null,
  };
}

interface ProfileRowShape {
  isPublished: boolean;
  headline: string | null;
  bio: string | null;
  area: string | null;
  tags: string[];
  xUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  lineUrl: string | null;
  showStats: boolean;
  avatarImageId: string | null;
  themeId: string | null;
}

function avatarUrlOf(avatarImageId: string | null): string | null {
  return avatarImageId ? imageAssetImagePath(avatarImageId) : null;
}

/** DB の行を公開ページの形にする。非公開なら中身を一切出さない。 */
export function profileContentFromRow(
  row: ProfileRowShape | null,
  stats: OrganizerProfileStats | null,
): OrganizerProfileContent {
  // アイコンは本文ではなく、その人を示す印。非公開でも出す。
  if (!row || !row.isPublished) {
    return { ...emptyContent(), avatarUrl: avatarUrlOf(row?.avatarImageId ?? null) };
  }
  return {
    isPublished: true,
    headline: row.headline?.trim() || null,
    bio: row.bio?.trim() || null,
    area: row.area?.trim() || null,
    tags: normalizeProfileTags(row.tags),
    links: profileLinks({
      xUrl: row.xUrl ?? "",
      instagramUrl: row.instagramUrl ?? "",
      websiteUrl: row.websiteUrl ?? "",
      lineUrl: row.lineUrl ?? "",
    }),
    stats: row.showStats ? stats : null,
    avatarUrl: avatarUrlOf(row.avatarImageId),
    themeId: normalizeSemanticThemeId(row.themeId),
  };
}

function toDraft(row: ProfileRowShape | null): OrganizerProfileDraft {
  if (!row) return { ...EMPTY_PROFILE_DRAFT };
  return {
    isPublished: row.isPublished,
    headline: row.headline ?? "",
    bio: row.bio ?? "",
    area: row.area ?? "",
    tags: normalizeProfileTags(row.tags),
    xUrl: row.xUrl ?? "",
    instagramUrl: row.instagramUrl ?? "",
    websiteUrl: row.websiteUrl ?? "",
    lineUrl: row.lineUrl ?? "",
    showStats: row.showStats,
    themeId: normalizeSemanticThemeId(row.themeId),
  };
}

const eventStatSelect = {
  status: true,
  isDeleted: true,
  schedules: { select: { eventDate: true } },
} as const;

interface EventStatRow {
  status: ProfileStatSource["status"];
  isDeleted: boolean;
  schedules: { eventDate: Date }[];
}

function toStatSource(row: EventStatRow): ProfileStatSource {
  return {
    status: row.status,
    isDeleted: row.isDeleted,
    schedules: row.schedules.map((schedule) => ({ eventDate: formatEventDate(schedule.eventDate) })),
  };
}

/**
 * 公開プロフィールを読む。会員が無い・退会済み・催しが0件なら null（画面は 404）。
 * 非公開でも名前は返す（ホーム自体は開ける）。
 */
export async function loadPublicOrganizerProfile(userId: string): Promise<LoadedOrganizerProfile | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      organizerProfile: true,
      organizers: {
        where: { event: { isDeleted: false } },
        select: { event: { select: eventStatSelect } },
      },
    },
  });
  if (!user || user.organizers.length === 0) return null;

  const stats = profileStats(
    user.organizers.map((row) => toStatSource(row.event)),
    todayInTokyo(),
  );
  return {
    userId: user.id,
    name: user.name,
    profile: profileContentFromRow(user.organizerProfile, stats),
  };
}

/** 自分の催しから実績を数える。編集画面のプレビューに使う。 */
export async function readOrganizerProfileStats(userId: string): Promise<OrganizerProfileStats | null> {
  const rows = await prisma.eventOrganizer.findMany({
    where: { userId },
    select: { event: { select: eventStatSelect } },
  });
  return profileStats(rows.map((row) => toStatSource(row.event)), todayInTokyo());
}

/** 編集画面の下書き。行が無ければ既定値。 */
export async function readOrganizerProfileDraft(userId: string): Promise<OrganizerProfileDraft> {
  const row = await prisma.organizerProfile.findUnique({ where: { userId } });
  return toDraft(row);
}

/** 初回保存で行を作り、2回目以降は更新する。 */
export async function upsertOrganizerProfile(
  userId: string,
  input: OrganizerProfileInput,
): Promise<OrganizerProfileDraft> {
  const data = {
    isPublished: input.isPublished,
    headline: input.headline,
    bio: input.bio,
    area: input.area,
    tags: input.tags,
    xUrl: input.xUrl,
    instagramUrl: input.instagramUrl,
    websiteUrl: input.websiteUrl,
    lineUrl: input.lineUrl,
    showStats: input.showStats,
    themeId: normalizeSemanticThemeId(input.themeId),
  };
  const row = await prisma.organizerProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return toDraft(row);
}

/** 設定中のアイコン画像の ID。未設定・行なしは null。 */
export async function readOrganizerAvatarId(userId: string): Promise<string | null> {
  const row = await prisma.organizerProfile.findUnique({
    where: { userId },
    select: { avatarImageId: true },
  });
  return row?.avatarImageId ?? null;
}

/** 設定中のアイコンの URL。未設定・行なしは null。 */
export async function readOrganizerAvatarUrl(userId: string): Promise<string | null> {
  return avatarUrlOf(await readOrganizerAvatarId(userId));
}

/**
 * アイコンの参照を差し替える。行が無ければ作る（未作成の会員でも設定できる）。
 * 差し替え前の画像は呼び出し側が退役させる。ここでは参照だけを動かす。
 */
export async function setOrganizerAvatar(
  userId: string,
  avatarImageId: string | null,
): Promise<void> {
  await prisma.organizerProfile.upsert({
    where: { userId },
    create: { userId, avatarImageId },
    update: { avatarImageId },
  });
}

/** アイコンの参照を外す。外した画像の ID を返す（退役させるため）。 */
export async function clearOrganizerAvatar(userId: string): Promise<string | null> {
  const row = await prisma.organizerProfile.findUnique({
    where: { userId },
    select: { avatarImageId: true },
  });
  const previous = row?.avatarImageId ?? null;
  if (!previous) return null;
  await prisma.organizerProfile.update({
    where: { userId },
    data: { avatarImageId: null },
  });
  return previous;
}

/** 主催イベントを1件以上持つ会員か。持たない会員は編集画面を使えない。 */
export async function assertOrganizerMember(userId: string): Promise<void> {
  const count = await prisma.eventOrganizer.count({
    where: { userId, event: { isDeleted: false } },
  });
  if (count === 0) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "公開プロフィールは、主催イベントを持つ会員だけが使えます。",
      error: "NOT_ORGANIZER",
    });
  }
}
