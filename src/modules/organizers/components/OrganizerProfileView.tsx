import { profileInitial } from "@/modules/organizers/lib/profile";
import {
  PROFILE_TAG_LABELS,
  type OrganizerProfileContent,
  type ProfileLinkKind,
} from "@/modules/organizers/types";
import { Alert, EmptyState } from "@/components/ui";

interface OrganizerProfileViewProps {
  name: string;
  profile: OrganizerProfileContent;
  /**
   * 編集画面のプレビュー。非公開でも中身を描き、公開したときの見え方を確かめられる。
   */
  preview?: boolean;
}

/**
 * 主催者の公開ページ（SCR-PUB-14）のプロフィール部分。
 *
 * サーバーコンポーネントからも、編集画面のプレビューからも同じ見た目で使う。
 * 非公開の会員は名前だけを出す（自己紹介・リンク・実績は出さない）。
 * 催し（カレンダーと一覧）は同じページの下に置き、ここでは人物 1 枚に絞る。
 */
export function OrganizerProfileView({
  name,
  profile,
  preview = false,
}: OrganizerProfileViewProps) {
  const showContent = profile.isPublished || preview;

  return (
    <div className="stack">
      <div className="profile-head">
        <span className="profile-head__avatar">
          {profile.avatarUrl ? (
            // 64px で出し、画像は 256px を配る。比率は枠側で切る。
            <img src={profile.avatarUrl} alt="" width={64} height={64} decoding="async" />
          ) : (
            <span aria-hidden="true">{profileInitial(name)}</span>
          )}
        </span>
        <div>
          <p className="eyebrow">主催者</p>
          <h1 className="profile-head__name">{name}</h1>
          {showContent && profile.headline && <p className="profile-head__title">{profile.headline}</p>}
        </div>
      </div>

      {showContent && profile.tags.length > 0 && (
        <div className="genre-chips" aria-label="活動ジャンル">
          {profile.tags.map((tag) => (
            <span key={tag} className="chip">
              {PROFILE_TAG_LABELS[tag]}
            </span>
          ))}
        </div>
      )}

      {preview && !profile.isPublished && (
        <Alert tone="info">
          いまは非公開です。この内容は参加者に表示されません。公開すると、この見え方で表示されます。
        </Alert>
      )}

      {showContent && profile.bio && <p className="profile-bio">{profile.bio}</p>}

      {showContent && (profile.area || profile.stats) && (
        <dl className="kv">
          {profile.area && (
            <div className="kv__row">
              <dt>活動エリア</dt>
              <dd>{profile.area}</dd>
            </div>
          )}
          {profile.stats && (
            <div className="kv__row">
              <dt>催しの数</dt>
              <dd>
                これまで {profile.stats.eventCount}回 ／ {profile.stats.sinceYear}年から
              </dd>
            </div>
          )}
        </dl>
      )}

      {showContent && profile.links.length > 0 && (
        <ul className="profile-links" aria-label="主催者のリンク">
          {profile.links.map((link) => (
            <li key={link.kind}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={link.label}
              >
                <ProfileLinkIcon kind={link.kind} />
                <span className="visually-hidden">{link.label}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {!showContent && (
        <EmptyState>この主催者は、まだプロフィールを公開していません。</EmptyState>
      )}

      <p className="screen-note">
        プロフィールを公開していない主催者は、名前だけを出します。この画面は検索には出しません。
      </p>
    </div>
  );
}

/** X / Instagram のブランドマーク。文字ラベルは visually-hidden で残す。 */
function ProfileLinkIcon({ kind }: { kind: ProfileLinkKind }) {
  if (kind === "INSTAGRAM") {
    return (
      <svg viewBox="0 0 24 24" className="profile-links__icon" aria-hidden="true">
        <path
          fill="currentColor"
          d="M7 3.5h10A3.5 3.5 0 0 1 20.5 7v10a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 17V7A3.5 3.5 0 0 1 7 3.5zm0 1.5A2 2 0 0 0 5 7v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7zm10.25 1.25a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 1.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="profile-links__icon" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14.6 3.5h2.72l-5.95 6.8 7.01 10.2h-5.48l-4.29-5.86-4.91 5.86H1l6.36-7.58L.7 3.5h5.62l3.88 5.38 4.4-5.38zm-.95 15.27h1.51L6.42 5.15H4.8l8.85 13.62z"
      />
    </svg>
  );
}
