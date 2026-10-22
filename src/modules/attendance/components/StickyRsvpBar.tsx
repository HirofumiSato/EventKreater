interface StickyRsvpBarProps {
  attendingCount: number;
  waitlistCount: number;
  capacity: number | null;
  answered: boolean;
  closed: boolean;
}

export function StickyRsvpBar({ attendingCount, waitlistCount, capacity, answered, closed }: StickyRsvpBarProps) {
  const full = capacity !== null && attendingCount >= capacity;
  return (
    <div className="sticky-rsvp">
      <p className="help" style={{ margin: 0 }}>
        参加 {attendingCount}名
        {capacity !== null && ` / 定員 ${capacity}名`}
        {waitlistCount > 0 && ` · 要望 ${waitlistCount}名`}
        {answered ? " · 回答済み" : ""}
      </p>
      {closed ? (
        <button type="button" className="btn btn--primary btn--sm" disabled>
          受付終了
        </button>
      ) : (
        <a href="#rsvp" className="btn btn--primary btn--sm">
          {answered ? "回答を変更" : full ? "参加要望を出す" : "出欠を回答"}
        </a>
      )}
    </div>
  );
}
