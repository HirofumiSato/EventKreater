import { SITE } from "@/lib/site";

/**
 * 公開ページのフッター。
 *
 * 通常は `SiteChrome` が描く。テーマ付きの公開ページでは、フッターをテーマの地の
 * 内側へ置くためにページ側の器（`PublicThemeShell`）が描く（`SiteChrome` は
 * `main` もフッターも出さない）。どちらから描いても同じマークアップになるよう、
 * ここ 1 か所に集める。JavaScript を持たないので、サーバーコンポーネントから使える。
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>{SITE.name}</p>
        <ul className="site-footer__links">
          <li>
            <a href={SITE.nav.home.href}>{SITE.nav.home.label}</a>
          </li>
          <li>
            <a href={SITE.nav.service.href}>{SITE.nav.service.label}</a>
          </li>
          <li>
            <a href={SITE.nav.createEvent.href}>{SITE.nav.createEvent.label}</a>
          </li>
          <li>
            <a href={SITE.nav.participantLogin.href}>{SITE.nav.participantLogin.label}</a>
          </li>
          <li>
            <a href={SITE.nav.organizerLogin.href}>{SITE.nav.organizerLogin.label}</a>
          </li>
          <li>
            <a href={SITE.nav.terms.href}>{SITE.nav.terms.label}</a>
          </li>
          <li>
            <a href={SITE.nav.privacy.href}>{SITE.nav.privacy.label}</a>
          </li>
          <li>
            <a href={SITE.nav.tokushoho.href}>{SITE.nav.tokushoho.label}</a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
