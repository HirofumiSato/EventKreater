import type { RsvpStatus } from "@/modules/events/types";

/**
 * 出欠の3状態を、画面の文言と色に1か所で対応づける。
 *
 * `RsvpStatus` が2値だったころの「ATTENDING 以外は欠席」という三項演算子が
 * 各画面に散らばっていたため、参加要望を足したときに一括で直せるようにここへ寄せる。
 */
export const RSVP_STATUS_LABELS: Record<RsvpStatus, string> = {
  ATTENDING: "出席",
  DECLINED: "欠席",
  WAITLISTED: "参加要望中",
};

/** バッジと選択肢の色。CSS の `badge--{tone}` / `choice--{tone}` に対応する。 */
export type RsvpTone = "attending" | "declined" | "waitlist";

const RSVP_STATUS_TONES: Record<RsvpStatus, RsvpTone> = {
  ATTENDING: "attending",
  DECLINED: "declined",
  WAITLISTED: "waitlist",
};

export function rsvpStatusLabel(status: RsvpStatus): string {
  return RSVP_STATUS_LABELS[status];
}

export function rsvpStatusTone(status: RsvpStatus): RsvpTone {
  return RSVP_STATUS_TONES[status];
}

export function isWaitlisted(status: RsvpStatus): boolean {
  return status === "WAITLISTED";
}

/** 定員までの残り。定員が無ければ null（無制限）。 */
export function remainingSeats(capacity: number | null, attendingCount: number): number | null {
  if (capacity === null) return null;
  return Math.max(0, capacity - attendingCount);
}

export function isFull(capacity: number | null, attendingCount: number): boolean {
  const remaining = remainingSeats(capacity, attendingCount);
  return remaining !== null && remaining === 0;
}

export interface WaitlistRow {
  id: string;
  status: RsvpStatus;
  /** 要望を出した日時。移行前や要望でない行は null。 */
  waitlistedAt: Date | string | null;
  /** 要望日時が無いときの代わり。行の作成順で代用する。 */
  createdAt: Date | string;
}

function timeOf(value: Date | string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/** 待ち順。`waitlistedAt` 昇順、同時刻は `createdAt`、最後に id で安定させる。 */
export function sortWaitlistRows<T extends WaitlistRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftAt = timeOf(left.waitlistedAt ?? left.createdAt);
    const rightAt = timeOf(right.waitlistedAt ?? right.createdAt);
    if (leftAt !== rightAt) return leftAt - rightAt;
    const leftCreated = timeOf(left.createdAt);
    const rightCreated = timeOf(right.createdAt);
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return left.id.localeCompare(right.id);
  });
}

/** 待ち順の1始まりの位置。要望でない行・見つからない行は null。 */
export function waitlistPosition(rows: WaitlistRow[], participantId: string): number | null {
  const waiting = sortWaitlistRows(rows.filter((row) => isWaitlisted(row.status)));
  const index = waiting.findIndex((row) => row.id === participantId);
  return index === -1 ? null : index + 1;
}

export type RsvpChoiceMode = "attending" | "open" | "full";

export interface RsvpChoices {
  /** 「出席」を選べるか。 */
  attend: boolean;
  /** 「参加要望」を選べるか。 */
  waitlist: boolean;
  /** `attending` は席を確保済み、`open` は空きあり、`full` は満員。 */
  mode: RsvpChoiceMode;
}

/**
 * 出欠フォームに出す選択肢を決める。
 *
 * 席を確保済みの出席者は、満員になっても出席のまま変更できる。
 * 要望している人は、空きが出ていれば出席へ変更できる。
 */
export function nextRsvpChoices(input: {
  capacity: number | null;
  attendingCount: number;
  myStatus: RsvpStatus | null;
}): RsvpChoices {
  if (input.myStatus === "ATTENDING") {
    return { attend: true, waitlist: false, mode: "attending" };
  }
  const remaining = remainingSeats(input.capacity, input.attendingCount);
  if (remaining === null || remaining > 0) {
    return { attend: true, waitlist: false, mode: "open" };
  }
  return { attend: false, waitlist: true, mode: "full" };
}
