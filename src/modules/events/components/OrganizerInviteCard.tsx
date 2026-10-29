import Link from "next/link";
import { SITE } from "@/lib/site";
import { showsOrganizerInvite } from "@/modules/events/lib/organizer-invite";
import type { PublicEventViewer } from "@/modules/events/types";

interface OrganizerInviteCardProps {
  eventId: string;
  viewer: PublicEventViewer;
}

/**
 * 告知ページの出欠ボックスの直下に出す、別の主催者への勧誘。
 * 出す条件は `showsOrganizerInvite` が持ち、追従バーの帯（`StickyRsvpBar`）と共有する。
 * 受付停止（CLOSED）のページでも出す。参加希望者ではなく、次の主催者を拾う導線である。
 */
export function OrganizerInviteCard({ eventId, viewer }: OrganizerInviteCardProps) {
  if (!showsOrganizerInvite(viewer)) return null;

  return (
    <section className="org-invite" aria-labelledby="org-invite-title">
      <p className="org-invite__tag">無料ではじめられます</p>
      <h2 className="org-invite__title" id="org-invite-title">
        あなたも{SITE.nav.createEvent.label}をしませんか？
      </h2>
      <p className="org-invite__note">
        このページと同じチラシと告知ページを、5 分で作れます。最初の 2 回は無料です。
      </p>
      <Link
        href={`${SITE.nav.createEvent.href}?ref=${encodeURIComponent(eventId)}`}
        className="btn btn--outline"
      >
        {SITE.nav.createEvent.label}
      </Link>
    </section>
  );
}
