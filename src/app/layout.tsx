import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Zen_Kaku_Gothic_New, Zen_Maru_Gothic } from "next/font/google";
import { GoogleAnalytics } from "@/components/common/GoogleAnalytics";
import { SiteChrome } from "@/components/common/SiteChrome";
import { SITE } from "@/lib/site";
import { appBaseUrl } from "@/lib/http";
import "./globals.css";
/* 共有スタイルの入口。モック（style-guide/*.html）も同じファイルを読む。
   層の順番そのものが仕様で、装飾（deco）を最後に置く。 */
import "@/styles/index.css";

/**
 * 本文（Zen Kaku Gothic New）と見出し（Zen Maru Gothic）の書体。
 *
 * 以前は `<head>` から Google の CSS と preconnect を読んでいた。別ホストへの接続が
 * 描画の前に挟まるので、`next/font` でビルド時に取り込み、同じ配信元から出す。
 * 書体名は CSS 変数で `src/styles/tokens.css` の `--font` / `--font-display` へ渡す。
 * モック（`style-guide/*.html`）はこの変数を持たないので、tokens.css に書いた
 * 控えの書体名（literal）へ落ちる（見た目は変えない）。
 */
const bodyFont = Zen_Kaku_Gothic_New({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  /* 日本語は 1 ウェイトが 70 前後のサブセットに分かれる。既定のまま preload すると
     全サブセット（実測 359 本・4.8MB）を描画前に取りに行き、LCP が帯域待ちになる。
     描画に使う分だけを都度読む。 */
  preload: false,
  variable: "--font-zen-kaku",
});

const displayFont = Zen_Maru_Gothic({
  weight: ["500", "700"],
  subsets: ["latin"],
  display: "swap",
  /* 本文と同じ理由。日本語のサブセットが多いので先読みしない。
     ウェイトはテーマが前提にしているので減らさない。 */
  preload: false,
  variable: "--font-zen-maru",
});

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
    <html lang="ja" className={`${bodyFont.variable} ${displayFont.variable}`}>
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
