import { Panel } from "@/components/ui";
import { profileBioExcerpt, profileInitial } from "@/modules/organizers/lib/profile";
import type { ReferralInvite } from "@/modules/account/lib/referral-invite";

type ReferralInviteCardProps = Pick<ReferralInvite, "name" | "headline" | "bio" | "avatarUrl">;

/**
 * 紹介リンクの着地ページに出す、紹介者の 1 枚。
 *
 * 公開プロフィール（`OrganizerProfileView`）と同じ頭の組み方を使い、
 * 名前・肩書き・自己紹介の抜粋だけを見せる。全文・リンク・実績は出さない。
 */
export function ReferralInviteCard({ name, headline, bio, avatarUrl }: ReferralInviteCardProps) {
  const excerpt = profileBioExcerpt(bio, 120);

  return (
    <Panel as="div">
      <div className="profile-head">
        <span className="profile-head__avatar">
          {avatarUrl ? (
            // 64px で出し、画像は 256px を配る。比率は枠側で切る。
            <img src={avatarUrl} alt="" width={64} height={64} decoding="async" />
          ) : (
            <span aria-hidden="true">{profileInitial(name)}</span>
          )}
        </span>
        <div>
          <p className="profile-head__name">{name}</p>
          {headline && <p className="profile-head__title">{headline}</p>}
        </div>
      </div>
      {excerpt && <p className="profile-bio">{excerpt}</p>}
    </Panel>
  );
}
