import Link from "next/link";
import { profileInitial } from "@/modules/organizers/lib/profile";
import { PROFILE_TAG_LABELS, type OrganizerProfileContent } from "@/modules/organizers/types";

interface OrganizerProfileViewProps {
  userId: string;
  name: string;
  profile: OrganizerProfileContent;
  /** 催しページの URL。プレビューでは保存済みの URL を渡す。 */
  eventsPath?: string;
  /**
   * 編集画面のプレビュー。非公開でも中身を描き、公開したときの見え方を確かめられる。
   */
  preview?: boolean;
}

/**
 * 主催者の公開プロフィール（SCR-PUB-14）。
 *
 * サーバーコンポーネントからも、編集画面のプレビューからも同じ見た目で使う。
 * 非公開の会員は名前と催しへの導線だけを出す（自己紹介・リンク・実績は出さない）。
 */
export function OrganizerProfileView({
  userId,
  name,
  profile,
  eventsPath,
  preview = false,
}: OrganizerProfileViewProps) {
  const showContent = profile.isPublished || preview;
  const eventsHref = eventsPath ?? `/organizers/${userId}/events`;

  return (
    <div className="stack">
      <section className="profile-hero">
        <div className="profile-hero__avatar" aria-hidden="true">
          {profileInitial(name)}
        </div>
        <div className="profile-hero__body">
          <p className="eyebrow">主催者</p>
          <h1 className="profile-hero__name">{name}</h1>
          {showContent && profile.headline && <p className="profile-hero__headline">{profile.headline}</p>}

          {showContent && (profile.area || profile.tags.length > 0 || profile.links.length > 0) && (
            <div className="profile-meta">
              {profile.area && <span className="profile-area">{profile.area}</span>}
              {profile.tags.length > 0 && (
                <ul className="profile-tags" aria-label="活動ジャンル">
                  {profile.tags.map((tag) => (
                    <li key={tag} className="profile-tag">
                      {PROFILE_TAG_LABELS[tag]}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {showContent && profile.links.length > 0 && (
            <ul className="profile-links" aria-label="主催者のリンク">
              {profile.links.map((link) => (
                <li key={link.kind}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {preview && !profile.isPublished && (
        <p className="alert alert--info">
          いまは非公開です。この内容は参加者に表示されません。公開すると、この見え方で表示されます。
        </p>
      )}

      {showContent && profile.bio && (
        <section className="card">
          <h2 className="card__title">自己紹介</h2>
          <p className="profile-bio">{profile.bio}</p>
        </section>
      )}

      {showContent && profile.stats && (
        <section className="card">
          <h2 className="card__title">活動</h2>
          <dl className="profile-stats">
            <div>
              <dt className="profile-stats__label">主催した催し</dt>
              <dd className="profile-stats__value">{profile.stats.eventCount}回</dd>
            </div>
            <div>
              <dt className="profile-stats__label">活動開始</dt>
              <dd className="profile-stats__value">{profile.stats.sinceYear}年</dd>
            </div>
          </dl>
        </section>
      )}

      {!showContent && (
        <section className="card">
          <p className="empty">この主催者は、まだプロフィールを公開していません。</p>
        </section>
      )}

      <section className="panel">
        <div>
          <p className="eyebrow">催し</p>
          <h2 className="panel__title">{name}さんの催し</h2>
          <p className="panel__note">これから開催される催しの日程と会場を確認できます。</p>
        </div>
        <div className="panel__actions">
          <Link href={eventsHref} className="btn btn--primary">
            催しを見る
          </Link>
        </div>
      </section>
    </div>
  );
}
