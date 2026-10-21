"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/common/Navbar";
import { SITE } from "@/lib/site";

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const concealed = pathname.startsWith("/console");

  return (
    <>
      {concealed ? null : <Navbar />}
      <main id="main" className="page">
        {children}
      </main>
      {concealed ? null : (
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
            </ul>
          </div>
        </footer>
      )}
    </>
  );
}
