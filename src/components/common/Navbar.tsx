"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SITE } from "@/lib/site";
import {
  type Viewer,
  siteNavConfig,
  userMenuConfig,
  viewerInitial,
  viewerRole,
  viewerRoleCaption,
  viewerRoleLabel,
} from "@/lib/site-nav";
import { useUnreadNotifications } from "@/modules/notifications/hooks/useNotifications";
import { formatUnreadCount } from "@/modules/notifications/lib/unread";
import { StripePortalButton } from "@/modules/billing/components/StripePortalButton";

/**
 * 共通ヘッダー。
 *
 * 並べる機能は `src/lib/site-nav.ts` の `siteNavConfig` が、会員の状態とパスだけで決める。
 * この部品は、決まった並びを描くことと、メニューの開閉だけを持つ。
 * 「未ログイン／参加者／主催者（参加者画面・主催者画面）／管理者」の 4 通りで
 * 並びが変わる。ログイン中はスマホのバーに頭文字の札を出し、誰として入っているかは
 * 札を押して開くメニュー（名前・役割・行き先・ログアウト）で示す。
 *
 * 主催者画面はヘッダー直下の節（`OrganizerTabs`）が移動を担うので、バーのナビと
 * 開閉ボタンは置かない。同じ行き先を 2 か所に出すと、どちらが現在地か読めなくなる。
 *
 * スマホ（390px）がいちばん狭い前提で組む。バーは「ブランド・作成・頭文字」で
 * 埋まる。参加者画面と未ログインは、これにナビと開閉ボタンが加わる。
 *
 * いまどちらの画面にいるかは、バーの色と、頭文字の札の左に添える 1 語で示す。
 * 参加者画面と主催者画面は同じバーを使うので、並びが違うだけでは切り替えた
 * ことに気づけない。色は `data-viewer-role` が持ち、字は `viewerRoleCaption`
 * が持つ（色だけに頼らず、文字でも読ませる）。
 */
export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  // 通知は主催者にしか作られない。参加者の端末で 60 秒ごとに叩かない。
  const { unreadCount } = useUnreadNotifications(Boolean(viewer?.isOrganizer));
  const unreadLabel = formatUnreadCount(unreadCount);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/user/profile")
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as {
          user: { name: string; platformRole?: string };
          isOrganizer?: boolean;
        };
      })
      .then((data) => {
        if (!active) return;
        setViewer(
          data
            ? {
                name: data.user.name,
                isOrganizer: Boolean(data.isOrganizer),
                platformRole: data.user.platformRole === "ADMIN" ? "ADMIN" : "MEMBER",
              }
            : null,
        );
      })
      .catch(() => {
        if (active) setViewer(null);
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  // 画面を移ったらメニューは閉じる。
  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  // 開いている間だけ Esc と外側クリックを拾う。
  useEffect(() => {
    if (!menuOpen && !userMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setUserMenuOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const header = headerRef.current;
      if (header && !header.contains(event.target as Node)) {
        setMenuOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen, userMenuOpen]);

  const { links, primary, action } = siteNavConfig(pathname, viewer);
  const role = viewer ? viewerRole(pathname, viewer) : null;
  const roleLabel = role ? viewerRoleLabel(role) : "";
  const roleCaption = role ? viewerRoleCaption(role) : "";
  const initial = viewer ? viewerInitial(viewer.name) : "";
  // 主催者画面は節（org-subnav）が移動を担う。バーのナビは重ねない。
  const organizerView = role === "organizer";
  // 並べる行き先が無い画面（主催者画面・アカウント設定）では、ナビと開閉ボタンを出さない。
  const showNav = links.length > 0;
  // 主要な入口と切り替えリンクが並ぶときだけ、切り替えを狭い幅でメニューへ退避させる。
  const compactAction = Boolean(primary && action) && showNav && !organizerView;
  const menuAction = compactAction ? action : undefined;

  /**
   * 頭文字の札を押して開くメニューの中身。並びは `site-nav.ts` の `userMenuConfig` が決める。
   * 主催者画面では、バーから外した「参加者として見る」と、節に重ならない「下書き」をここが受ける。
   */
  const userMenuLinks = viewer ? userMenuConfig(pathname, viewer) : [];

  /** 2 つのメニューは同時に開かない。開けると帯が重なって読めなくなる。 */
  const toggleNav = () => {
    setUserMenuOpen(false);
    setMenuOpen((open) => !open);
  };

  const toggleUserMenu = () => {
    setMenuOpen(false);
    setUserMenuOpen((open) => !open);
  };

  /** ログアウト。管理者も同じ会員セッションなので、公開側の入口 1 本で足りる。 */
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      setViewer(null);
      setMenuOpen(false);
      setUserMenuOpen(false);
      router.replace("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header
      className="site-header"
      ref={headerRef}
      data-menu-open={menuOpen ? "true" : "false"}
      data-viewer-role={role ?? undefined}
    >
      <div className="site-header__inner">
        {/* ブランド名はサービス名だけを置く。いま誰として入っているかは、右端の
            頭文字の札の左に添える役割の札（`.site-role`）が示す。色に頼らず、字でも読ませる。 */}
        <div className="site-brand-block">
          <Link href={SITE.nav.home.href} className="site-brand">
            {SITE.name}
          </Link>
        </div>
        {showNav ? (
          <nav id="site-nav" className="site-nav" aria-label="サイト">
            {menuAction ? (
              // 540px 以下でだけ出す。バーの幅が足りない端末の受け皿。
              <div className="site-nav__action">
                <Link href={menuAction.href} className="btn btn--outline btn--sm btn--block">
                  {menuAction.label}
                </Link>
              </div>
            ) : null}
            {links.map((nav) => (
              <Link
                key={nav.href + nav.label}
                href={nav.href}
                className={`site-nav__link${pathname === nav.href ? " is-current" : ""}`}
                aria-current={pathname === nav.href ? "page" : undefined}
              >
                {nav.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="site-header__actions">
          {primary ? (
            <Link href={primary.href} className="btn btn--outline btn--sm">
              {primary.label}
            </Link>
          ) : null}
          {action && !organizerView ? (
            <Link
              href={action.href}
              className={`btn btn--outline btn--sm${compactAction ? " site-header__action" : ""}`}
            >
              {action.label}
            </Link>
          ) : null}
          {viewer ? (
            <>
              {/* いま誰として入っているか。頭文字の札のすぐ左に置き、
                  色（data-viewer-role）と同じ意味を字でも示す。 */}
              <span className="site-role">{roleCaption}</span>
              <div className="site-user">
                <button
                  type="button"
                  className="site-user__button"
                  aria-expanded={userMenuOpen}
                  aria-controls="site-user-menu"
                  aria-label={
                    unreadCount > 0
                      ? `${viewer.name}（${roleLabel}）のメニュー、未読 ${unreadCount} 件`
                      : `${viewer.name}（${roleLabel}）のメニュー`
                  }
                  onClick={toggleUserMenu}
                >
                  <span className="site-user__avatar" aria-hidden="true">
                    {initial}
                  </span>
                </button>
                {unreadLabel ? (
                  // 未読の数。色だけで伝えないよう、件数はボタンの aria-label が持つ。
                  <span className="site-user__badge" aria-hidden="true">
                    {unreadLabel}
                  </span>
                ) : null}
                <div
                  className="site-user-menu"
                  id="site-user-menu"
                  data-open={userMenuOpen ? "true" : "false"}
                >
                  <p className="site-user-menu__head">
                    <span className="site-user__avatar" aria-hidden="true">
                      {initial}
                    </span>
                    <span className="site-user-menu__name">{viewer.name}</span>
                    <span className="site-user__role">{roleLabel}</span>
                  </p>
                  {userMenuLinks.length > 0 ? (
                    <nav className="site-user-menu__links" aria-label="メニュー">
                      {userMenuLinks.map((nav) => (
                        <Link
                          key={nav.href + nav.label}
                          href={nav.href}
                          className="site-user-menu__link"
                          aria-current={pathname === nav.href ? "page" : undefined}
                        >
                          {nav.label}
                          {nav.href === SITE.nav.notifications.href && unreadLabel ? (
                            <span className="site-user-menu__count" aria-hidden="true">
                              {unreadLabel}
                            </span>
                          ) : null}
                        </Link>
                      ))}
                    </nav>
                  ) : null}
                  {/* 契約の入口。マイページの「利用枠と契約」の節を畳んだので、ここが受ける。
                      主催者として見ているあいだだけ出す（参加者画面では契約を持たない）。 */}
                  {role === "organizer" ? <StripePortalButton /> : null}
                  <button
                    type="button"
                    className="site-user-menu__logout"
                    onClick={() => void logout()}
                    disabled={loggingOut}
                  >
                    {SITE.action.logout}
                  </button>
                </div>
              </div>
            </>
          ) : null}
          {showNav ? (
            <button
              type="button"
              className="site-menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="site-nav"
              aria-label="メニュー"
              onClick={toggleNav}
            >
              <span className="site-menu-toggle__bar" aria-hidden="true" />
              <span className="site-menu-toggle__bar" aria-hidden="true" />
              <span className="site-menu-toggle__bar" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
