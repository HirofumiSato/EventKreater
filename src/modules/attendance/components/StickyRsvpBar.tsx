import Link from "next/link";

interface StickyRsvpBarProps {
  attendingCount: number;
  waitlistCount: number;
  capacity: number | null;
  answered: boolean;
  closed: boolean;
  /** 主催者の公開ページ。会員の幹事のときだけ、左に並べる。 */
  organizerHref?: string | null;
}

/**
 * 画面下に残す出欠の導線。長い告知ページでも、いつでも答えられるようにする。
 *
 * 参加人数は札（EventMetaCard）にも出るので、狭い画面では落とす（CSS 側）。
 * ボタンは 2 つまで。主催者のページと、出欠の回答。
 */
export function StickyRsvpBar({
  attendingCount,
  waitlistCount,
  capacity,
  answered,
  closed,
  organizerHref = null,
}: StickyRsvpBarProps) {
  const full = capacity !== null && attendingCount >= capacity;
  return (
    <div className="sticky-rsvp">
      <p className="help">
        参加 {attendingCount}名
        {capacity !== null && ` / 定員 ${capacity}名`}
        {waitlistCount > 0 && ` · 要望 ${waitlistCount}名`}
        {answered ? " · 回答済み" : ""}
      </p>
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
        <a href="#rsvp" className="btn btn--primary btn--sm">
          {answered ? "回答を変更" : full ? "参加要望を出す" : "出欠を答える"}
        </a>
      )}
    </div>
  );
}
