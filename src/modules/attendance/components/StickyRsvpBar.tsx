interface StickyRsvpBarProps {
  attendingCount: number;
  answered: boolean;
  closed: boolean;
}

export function StickyRsvpBar({ attendingCount, answered, closed }: StickyRsvpBarProps) {
  return (
    <div className="sticky-rsvp">
      <p className="help" style={{ margin: 0 }}>
        参加 {attendingCount}名{answered ? " · 回答済み" : ""}
      </p>
      {closed ? (
        <button type="button" className="btn btn--primary btn--sm" disabled>
          受付終了
        </button>
      ) : (
        <a href="#rsvp" className="btn btn--primary btn--sm">
          {answered ? "回答を変更" : "出欠を回答"}
        </a>
      )}
    </div>
  );
}
