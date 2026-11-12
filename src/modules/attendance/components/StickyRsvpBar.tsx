import Link from "next/link";
import { SITE } from "@/lib/site";
import { showsAttendingCount } from "@/modules/events/lib/rsvp-status";

interface StickyRsvpBarProps {
  attendingCount: number;
  waitlistCount: number;
  capacity: number | null;
  answered: boolean;
  closed: boolean;
  /** 出欠の層を開く。入口はこの帯 1 つ（広い画面は面のボタンが受ける）。 */
  onOpen: () => void;
  /** 主催者の公開ページ。会員の幹事のときだけ、左に並べる。 */
  organizerHref?: string | null;
  /** 下段に「あなたもイベントを開きませんか」の帯を出すか。条件は `showsOrganizerInvite` が持つ。 */
  showInvite?: boolean;
}

/**
 * 画面下に残す出欠の導線。長い告知ページでも、いつでも答えられるようにする。
 *
 * 押すと画面の中の位置へ飛ぶのではなく、その場で出欠の層を開く。
 * 告知ページは読み物として完結させ、申込は紙の上に乗せる（`DynamicRsvpBox` の説明）。
 *
 * 参加人数は札（EventMetaCard）にも出るので、狭い画面では落とす（CSS 側）。
 * ボタンは 2 つまで。主催者のページと、出欠の回答。
 * 下段の帯（`showInvite`）は出欠の導線ではないので、ボタンとして数えない。
 */
export function StickyRsvpBar({
  attendingCount,
  waitlistCount,
  capacity,
  answered,
  closed,
  onOpen,
  organizerHref = null,
  showInvite = false,
}: StickyRsvpBarProps) {
  const full = capacity !== null && attendingCount >= capacity;
  /**
   * 本文の札（`EventMetaCard`）と同じ境目で参加人数を出す。
   * 定員の半分を超えるまでは「定員 N名」だけにし、少ない人数を見せない。
   */
  const countLabel = showsAttendingCount(capacity, attendingCount)
    ? `参加 ${attendingCount}名${capacity !== null ? ` / 定員 ${capacity}名` : ""}`
    : capacity !== null
      ? `定員 ${capacity}名`
      : null;
  const notes = [
    waitlistCount > 0 ? `要望 ${waitlistCount}名` : null,
    answered ? "回答済み" : null,
  ].filter((part): part is string => part !== null);
  const summary = [...(countLabel ? [countLabel] : []), ...notes].join(" · ");
  return (
    <div className="sticky-rsvp">
      {summary && <p className="help">{summary}</p>}
      {organizerHref && (
        <Link href={organizerHref} className="btn btn--outline btn--sm">
          主催者を見る
        </Link>
      )}
      {closed ? (
        <button type="button" className="btn btn--primary btn--sm" disabled>
          受付終了
        </button>
      ) : (
        <button type="button" className="btn btn--primary btn--sm" onClick={onOpen}>
          {answered ? "回答を変更" : full ? "参加要望を出す" : "申込 /出欠回答"}
        </button>
      )}
      {showInvite && (
        <p className="sticky-rsvp__invite">
          <Link href={SITE.nav.home.href}>あなたもイベントを開きませんか</Link>
        </p>
      )}
    </div>
  );
}
