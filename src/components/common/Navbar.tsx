"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SITE } from "@/lib/site";

interface Viewer {
  name: string;
  isOrganizer: boolean;
}

interface NavLink {
  href: string;
  label: string;
}

/**
 * links はメニューに入るテキストリンク、primary はバーに常時出す主要な入口、
 * action は切り替えリンク。primary と action がそろうと、幅が足りない端末では
 * action だけをメニュー先頭へ退避させる。
 */
interface NavConfig {
  links: readonly NavLink[];
  primary?: NavLink;
  action?: NavLink;
}

/** 主催者向けの画面。ここでは参加者の機能を並べず、切り替えリンク 1 本に留める。 */
const ORGANIZER_AREA_PREFIXES = ["/mypage", "/organizer", "/invitations"] as const;

function inOrganizerArea(pathname: string): boolean {
  return ORGANIZER_AREA_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function participantConfig(viewer: Viewer): NavConfig {
  return {
    links: [
      SITE.nav.participantHome,
      SITE.nav.participantCalendar,
      SITE.nav.participantHistory,
      SITE.nav.account,
      ...(viewer.isOrganizer ? [SITE.nav.mypage] : []),
    ],
    // 主催者としても使える人には切り替えを出さない。行き来は主催者画面側の 1 本だけ。
    action: viewer.isOrganizer ? undefined : SITE.nav.organizerSwitch,
  };
}

/**
 * 経路から並べる機能を決める。
 * 主催者の機能と参加者の機能は同じ並びに混ぜない。
 */
function navConfig(pathname: string, viewer: Viewer | null): NavConfig {
  if (!viewer) {
    return {
      links: [SITE.nav.service, SITE.nav.participantLogin],
      primary: SITE.nav.createEvent,
      action: SITE.nav.organizerLogin,
    };
  }
  const organizer: NavConfig = {
    links: [SITE.nav.organizerList, SITE.nav.mypage, SITE.nav.account],
    primary: SITE.nav.createEvent,
    action: SITE.nav.participantSwitch,
  };
  if (pathname === SITE.nav.account.href) {
    return viewer.isOrganizer ? organizer : participantConfig(viewer);
  }
  return inOrganizerArea(pathname) ? organizer : participantConfig(viewer);
}

/**
 * 共通ヘッダー。
 * 未ログイン、参加者、主催者（参加者画面）、主催者（主催者画面）の 4 通りで
 * 並べる機能を変える。「イベント告知ページを作る」はバーに常時出す。
 * 768px 以下ではリンク群を、540px 以下では切り替えリンクもメニューへ畳む。
 */
export function Navbar() {
  const pathname = usePathname();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/user/profile")
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { user: { name: string }; isOrganizer?: boolean };
      })
      .then((data) => {
        if (!active) return;
        setViewer(
          data ? { name: data.user.name, isOrganizer: Boolean(data.isOrganizer) } : null,
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

  const { links, primary, action } = navConfig(pathname, viewer);
  // 主要な入口と切り替えリンクが並ぶときだけ、切り替えを狭い幅でメニューへ退避させる。
  const compactAction = Boolean(primary && action);
  const menuAction = compactAction ? action : undefined;

  return (
    <header
      className="site-header"
      ref={headerRef}
      data-menu-open={menuOpen ? "true" : "false"}
    >
      <div className="site-header__inner">
        <Link href={SITE.nav.home.href} className="site-brand">
          {SITE.name}
        </Link>
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
