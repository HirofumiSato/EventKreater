"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE } from "@/lib/site";

/**
 * 見本の画面であることを示す帯（SCR-PUB-16 / SCR-PUB-17）。
 *
 * 告知ページの見本は、本物の告知ページとそっくりに作る。そのぶん、開いた人が
 * 「参加できる」と受け取らないよう、画面の上端に帯を固定して 3 つのことを伝える。
 * 「サンプル」「実際に作った告知ページ」「無料ではじめる」。
 *
 * 帯は共通ヘッダーの代わりでもある（`siteChrome("/sample/…")` はヘッダーを出さない）。
 * 詳細では「← 一覧」を足し、一覧へ戻れるようにする。帯は 1 段（高さ 53px）に保ち、
 * 折り返すと本文を押し下げるので、説明は幅のある画面だけに出す。
 */
export function SampleBand() {
  const pathname = usePathname();
  // 一覧（/sample）では戻り先が無い。詳細だけに出す。
  const inDetail = pathname !== "/sample";

  return (
    <div className="sample-band">
      <div className="sample-band__inner">
        <p className="sample-band__tag">サンプル</p>
        <p className="sample-band__note">実際に作った告知ページです</p>
        <div className="sample-band__actions">
          {inDetail && (
            <Link
              href={SITE.nav.sample.href}
              className="sample-band__back"
              aria-label="サンプルの一覧へ戻る"
            >
              ← 一覧
            </Link>
          )}
          <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--sm">
            {SITE.cta.createEventFree}
          </Link>
        </div>
      </div>
    </div>
  );
}
