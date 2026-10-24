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
 * ここでは催しを取得しない。一覧は催しページに任せ、この画面は人物 1 枚に絞る。
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
      <div className="profile-head">
        <span className="profile-head__avatar" aria-hidden="true">
          {profileInitial(name)}
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
        <p className="alert alert--info">
          いまは非公開です。この内容は参加者に表示されません。公開すると、この見え方で表示されます。
        </p>
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
              <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}

      {!showContent && (
        <p className="empty">この主催者は、まだプロフィールを公開していません。</p>
      )}

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">{name}さんの催し</h2>
          <p className="section__note">これから開催される催しの日程と会場を確認できます。</p>
        </div>
        <div className="panel__actions">
          <Link href={eventsHref} className="btn btn--primary">
            催しを見る
          </Link>
        </div>
      </section>

      <p className="screen-note">
        プロフィールを公開していない主催者は、名前と催しへの導線だけを出します。この画面は検索には出しません。
      </p>
    </div>
  );
}
