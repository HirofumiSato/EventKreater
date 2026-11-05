import type { ReactNode } from "react";
import type { Metadata } from "next";
import { GoogleAnalytics } from "@/components/common/GoogleAnalytics";
import { SiteChrome } from "@/components/common/SiteChrome";
import { SITE } from "@/lib/site";
import { appBaseUrl } from "@/lib/http";
import "./globals.css";
/* 共有スタイルの入口。モック（style-guide/*.html）も同じファイルを読む。
   層の順番そのものが仕様で、装飾（deco）を最後に置く。 */
import "@/styles/index.css";

export const metadata: Metadata = {
  metadataBase: new URL(appBaseUrl()),
  title: SITE.name,
  description: SITE.description,
  /* アイコンは `npm run icons` が `public/icons/app-icon-source.jpg` から作る
     （`scripts/build-icons.mjs`）。大きさごとに書き出すのは、192px の 1 枚を
     ブラウザに縮めさせると 16px のタブで滲むため。`favicon.ico` は、アイコンの
     リンクを読まない相手（RSS リーダーやブックマークの取り込み）向けに置く。 */
  icons: {
    icon: [
      { url: "/icons/icon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/icons/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/icon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/icons/icon-96.png", type: "image/png", sizes: "96x96" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/icons/apple-icon-180.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Zen+Maru+Gothic:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">
          本文へ
        </a>
        <SiteChrome>{children}</SiteChrome>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
