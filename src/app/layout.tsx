import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SiteChrome } from "@/components/common/SiteChrome";
import { SITE } from "@/lib/site";
import { appBaseUrl } from "@/lib/http";
import "./globals.css";
import "./attendance.css";

export const metadata: Metadata = {
  metadataBase: new URL(appBaseUrl()),
  title: SITE.name,
  description: SITE.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">
          本文へ
        </a>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
