import Link from "next/link";
import type { PublicEventViewer } from "@/modules/events/types";

interface OrganizerInviteCardProps {
  eventId: string;
  viewer: PublicEventViewer;
}

/**
 * 告知ページの出欠ボックスの直下に出す、別の主催者への勧誘。
 * 主催者本人（ゲスト幹事の端末 Cookie を含む）と、すでに主催イベントを持つ会員には出さない。
 * 受付停止（CLOSED）のページでも出す。参加希望者ではなく、次の主催者を拾う導線である。
 */
export function OrganizerInviteCard({ eventId, viewer }: OrganizerInviteCardProps) {
  if (viewer.isThisEventsOrganizer || viewer.hasOrganizerRole) return null;

  return (
    <section className="card card--padded">
      <h2 className="panel__title">あなたもイベントを作りませんか？</h2>
      <Link
        href={`/organizer/events/new?ref=${encodeURIComponent(eventId)}`}
        className="btn btn--outline btn--block"
      >
        イベントを作る
      </Link>
    </section>
  );
}
