"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SITE } from "@/lib/site";
import { type Viewer, siteNavConfig, viewerInitial, viewerRole, viewerRoleLabel } from "@/lib/site-nav";

/**
 * 共通ヘッダー。
 *
 * 並べる機能は `src/lib/site-nav.ts` の `siteNavConfig` が、会員の状態とパスだけで決める。
 * この部品は、決まった並びを描くことと、メニューの開閉だけを持つ。
 * 「未ログイン／参加者／主催者（参加者画面・主催者画面）／管理者」の 4 通りで
 * 並びが変わる。ログイン中はスマホのバーに頭文字の札を出し、誰として入っているかは
 * 役割の札と、メニューの中の名前で示す。
 *
 * スマホ（390px）がいちばん狭い前提で組む。バーは「ブランド・作成・頭文字・メニュー」で
 * 埋まるため、名前・役割・ログアウトはメニューの中に置く。1024px 以上のバーに余白が
 * できたら、頭文字・役割の札・ログアウトをバーへ開く。768〜1023px はナビと作成と
 * 切り替えで埋まっていて、頭文字 1 つでもナビが折り返すため、ヘッダーには出さない。
 */
export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

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
  }, [pathname]);

  // 開いている間だけ Esc と外側クリックを拾う。
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const header = headerRef.current;
      if (header && !header.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  const { links, primary, action } = siteNavConfig(pathname, viewer);
  // 主要な入口と切り替えリンクが並ぶときだけ、切り替えを狭い幅でメニューへ退避させる。
  const compactAction = Boolean(primary && action);
  const menuAction = compactAction ? action : undefined;
  const role = viewer ? viewerRole(pathname, viewer) : null;
  const roleLabel = role ? viewerRoleLabel(role) : "";
  const initial = viewer ? viewerInitial(viewer.name) : "";

  /** ログアウト。管理者も同じ会員セッションなので、公開側の入口 1 本で足りる。 */
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      setViewer(null);
      setMenuOpen(false);
      router.replace("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="site-header" ref={headerRef} data-menu-open={menuOpen ? "true" : "false"}>
      <div className="site-header__inner">
        <Link href={SITE.nav.home.href} className="site-brand">
          {SITE.name}
        </Link>
        <nav id="site-nav" className="site-nav" aria-label="サイト">
          {viewer ? (
            // スマホのメニュー先頭。誰として入っているかとログアウトをまとめる。
            <div className="site-nav__user">
              <span className="site-user__avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="site-nav__user-name">{viewer.name}</span>
              <span className="site-user__role">{roleLabel}</span>
              <button
                type="button"
                className="btn btn--outline btn--sm site-nav__logout"
                onClick={() => void logout()}
                disabled={loggingOut}
              >
                {SITE.action.logout}
              </button>
            </div>
          ) : null}
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
        <div className="site-header__actions">
          {primary ? (
            <Link href={primary.href} className="btn btn--outline btn--sm">
              {primary.label}
            </Link>
          ) : null}
          {action ? (
            <Link
              href={action.href}
              className={`btn btn--outline btn--sm${compactAction ? " site-header__action" : ""}`}
            >
              {action.label}
            </Link>
          ) : null}
          {viewer ? (
            // スマホでは頭文字だけ。役割の札とログアウトは 1024px 以上で開く。
            <div className="site-header__user">
              <span className="site-user__avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="visually-hidden">{viewer.name}</span>
              <span className="site-user__role">{roleLabel}</span>
              <button
                type="button"
                className="btn btn--outline btn--sm site-header__logout"
                onClick={() => void logout()}
                disabled={loggingOut}
              >
                {SITE.action.logout}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="site-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            aria-label="メニュー"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="site-menu-toggle__bar" aria-hidden="true" />
            <span className="site-menu-toggle__bar" aria-hidden="true" />
            <span className="site-menu-toggle__bar" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
