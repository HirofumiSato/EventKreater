"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE } from "@/lib/site";

interface Viewer {
  name: string;
  isOrganizer: boolean;
}

/** 主催者向けの画面。ここでは参加者の機能を並べず、切り替えリンク 1 本に留める。 */
const ORGANIZER_AREA_PREFIXES = ["/mypage", "/organizer", "/invitations"] as const;

function inOrganizerArea(pathname: string): boolean {
  return ORGANIZER_AREA_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * 共通ヘッダー。
 * 未ログイン、参加者、主催者（参加者画面）、主催者（主催者画面）の 4 通りで
 * 並べる機能を変え、主催者の機能と参加者の機能を同じ並びに混ぜない。
 */
export function Navbar() {
  const pathname = usePathname();
  const [viewer, setViewer] = useState<Viewer | null>(null);

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

  const isCurrent = (href: string) => pathname === href;

  const item = (nav: { href: string; label: string }) => (
    <Link
      key={nav.href + nav.label}
      href={nav.href}
      className={`site-nav__link${isCurrent(nav.href) ? " is-current" : ""}`}
      aria-current={isCurrent(nav.href) ? "page" : undefined}
    >
      {nav.label}
    </Link>
  );

  const renderGuestNav = () => (
    <>
      {item(SITE.nav.service)}
      {item(SITE.nav.createEvent)}
      {item(SITE.nav.participantLogin)}
      <Link href={SITE.nav.organizerLogin.href} className="btn btn--outline btn--sm">
        {SITE.nav.organizerLogin.label}
      </Link>
    </>
  );

  const renderOrganizerNav = () => (
    <>
      {item(SITE.nav.organizerList)}
      {item(SITE.nav.createEvent)}
      {item(SITE.nav.mypage)}
      {item(SITE.nav.account)}
      <Link href={SITE.nav.participantSwitch.href} className="btn btn--outline btn--sm">
        {SITE.nav.participantSwitch.label}
      </Link>
    </>
  );

  const renderParticipantNav = (isOrganizer: boolean) => (
    <>
      {item(SITE.nav.participantHome)}
      {item(SITE.nav.participantHistory)}
      {item(SITE.nav.account)}
      {isOrganizer ? (
        item(SITE.nav.mypage)
      ) : (
        <Link href={SITE.nav.organizerSwitch.href} className="btn btn--outline btn--sm">
          {SITE.nav.organizerSwitch.label}
        </Link>
      )}
    </>
  );

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href={SITE.nav.home.href} className="site-brand">
          {SITE.name}
        </Link>
        <nav className="site-nav" aria-label="サイト">
          {!viewer
            ? renderGuestNav()
            : pathname === SITE.nav.account.href
              ? viewer.isOrganizer
                ? renderOrganizerNav()
                : renderParticipantNav(false)
              : inOrganizerArea(pathname)
                ? renderOrganizerNav()
                : renderParticipantNav(viewer.isOrganizer)}
        </nav>
      </div>
    </header>
  );
}
