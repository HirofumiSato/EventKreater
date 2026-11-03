"use client";

import { useEffect } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { GA_MEASUREMENT_ID, analyticsEnabled, analyticsPagePath, trackPageView } from "@/lib/analytics";

/**
 * GA4（gtag.js）の読み込みとページビューの送信。
 *
 * ページビューは自動送信に任せず、パスが変わったときだけ手動で 1 回送る。
 * `useSearchParams` は Suspense 境界を要求するので使わない。クエリは `trackPageView` が落とす。
 */
export function GoogleAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    // 管理コンソールは `trackPageView` の中で弾かれる。
    trackPageView(pathname, document.title);
  }, [pathname]);

  // 測定 ID が空か本番以外なら、script も DOM も出さない。
  if (!analyticsEnabled()) return null;
  // 集計から外す画面（`/console` 配下）では gtag.js 自体を読み込まない。
  // 読み込むと、送らないのは page_view だけで、拡張計測（スクロール・外部リンク）は動いてしまう。
  if (analyticsPagePath(pathname ?? "") === null) return null;

  return (
    <>
      <Script id="ga-init" strategy="beforeInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(GA_MEASUREMENT_ID)}, { send_page_view: false });`}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`}
        strategy="afterInteractive"
      />
    </>
  );
}
