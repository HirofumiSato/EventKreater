/**
 * 主催者の公開プロフィール（`/organizers/[userId]`）で使う型。
 *
 * DB には ASCII の値で保存し、画面には日本語のラベルを出す。
 * 自由入力を許すと表記揺れで読み手に伝わらないため、ジャンルは固定リストにする。
 */

export const PROFILE_TAGS = [
  "MUSIC",
  "FOOD",
  "LEARNING",
  "SPORTS",
  "LOCAL",
  "BUSINESS",
  "OTHER",
] as const;

export type ProfileTag = (typeof PROFILE_TAGS)[number];

export const PROFILE_TAG_LABELS: Record<ProfileTag, string> = {
  MUSIC: "音楽",
  FOOD: "食",
  LEARNING: "学び",
  SPORTS: "スポーツ",
  LOCAL: "地域",
  BUSINESS: "ビジネス",
  OTHER: "その他",
};

/** 1人の主催者が選べるジャンルの上限。 */
export const MAX_PROFILE_TAGS = 3;

/** 公開ページに出すリンク。Webサイトと LINE は出さない。 */
export const PROFILE_LINK_LABELS = {
  X: "X",
  INSTAGRAM: "Instagram",
} as const;

export type ProfileLinkKind = keyof typeof PROFILE_LINK_LABELS;

export interface OrganizerProfileLink {
  kind: ProfileLinkKind;
  label: string;
  url: string;
}

/** 開催済みの催しから出する実績。人数と参加者名は含めない。 */
export interface OrganizerProfileStats {
  eventCount: number;
  sinceYear: number;
}

/** 公開ページとプレビューが描く、表示用に整えた形。 */
export interface OrganizerProfileContent {
  isPublished: boolean;
  headline: string | null;
  bio: string | null;
  area: string | null;
  tags: ProfileTag[];
  links: OrganizerProfileLink[];
  stats: OrganizerProfileStats | null;
}

/** 編集画面の入力。未入力は空文字で持ち、送信時に null へ寄せる。 */
export interface OrganizerProfileDraft {
  isPublished: boolean;
  headline: string;
  bio: string;
  area: string;
  tags: ProfileTag[];
  xUrl: string;
  instagramUrl: string;
  websiteUrl: string;
  lineUrl: string;
  showStats: boolean;
}

/** 編集画面の GET / PUT の応答。 */
export interface OrganizerProfileDraftResponse {
  name: string;
  profile: OrganizerProfileDraft;
  stats: OrganizerProfileStats | null;
  homePath: string;
}

/** 公開プロフィール API の応答。 */
export interface PublicOrganizerProfileResponse {
  userId: string;
  name: string;
  profile: OrganizerProfileContent;
}

export const EMPTY_PROFILE_DRAFT: OrganizerProfileDraft = {
  isPublished: false,
  headline: "",
  bio: "",
  area: "",
  tags: [],
  xUrl: "",
  instagramUrl: "",
  websiteUrl: "",
  lineUrl: "",
  showStats: false,
};
