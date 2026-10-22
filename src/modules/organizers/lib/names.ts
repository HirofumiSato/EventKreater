import type { OrganizerRole } from "@prisma/client";

/**
 * 主催者の表示名を1か所で決める。
 *
 * 会員の幹事は `User.name` を都度参照する（改名が公開ページにも反映される）。
 * ゲスト幹事は `EventOrganizer.displayName` を使う。どちらも無ければ名前を出さず、
 * 画面は役割名（主催者 / 共同主催者）だけを出す。
 */
export interface OrganizerNameSource {
  role: OrganizerRole;
  displayName?: string | null;
  user?: { name?: string | null } | null;
}

export const ORGANIZER_ROLE_LABELS: Record<OrganizerRole, string> = {
  OWNER: "主催者",
  CO_HOST: "共同主催者",
};

export function organizerDisplayName(row: OrganizerNameSource): string | null {
  const memberName = row.user?.name?.trim();
  if (memberName) return memberName;
  const guestName = row.displayName?.trim();
  if (guestName) return guestName;
  return null;
}

/** 名前が無いときの代わり。役割が分かる短い名詞にする。 */
export function organizerRoleLabel(role: OrganizerRole): string {
  return ORGANIZER_ROLE_LABELS[role];
}

/** 公開ページと一覧で使う、必ず空でない表示名。 */
export function organizerLabel(row: OrganizerNameSource): string {
  return organizerDisplayName(row) ?? organizerRoleLabel(row.role);
}

/** 名前を伏せたい場所（管理コンソール以外）で、未登録の幹事かどうかを出すための判定。 */
export function isGuestOrganizer(row: { userId?: string | null }): boolean {
  return !row.userId;
}
