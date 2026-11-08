import type { ReactNode } from "react";
import { SiteFooter } from "@/components/common/SiteFooter";
import { ThemeTypefaces } from "@/components/ui/ThemeTypefaces";
import { normalizeSemanticThemeId, type SemanticThemeId } from "@/lib/semantic-themes";

interface PublicThemeShellProps {
  /** 公開ページのテーマ。NULL・未知の値なら器を作らず、標準の見た目で出す。 */
  themeId: string | null | undefined;
  /** 上端の余白を落とすか。告知ページと見本は、帯を画面の上端から始める。 */
  flush?: boolean;
  children: ReactNode;
}

/**
 * テーマ付き公開ページの器。
 *
 * CSS 変数は子孫へしか継がれないため、フッターをテーマの色で塗るには、フッターを
 * テーマ要素の内側へ置くしかない。ここでは `<main>` とフッターを同じ要素で包み、
 * 地（`--st-surface-base`）を器が敷く（`themes.css` の `.semantic-theme--shell`）。
 *
 * テーマを選んでいないページは、要素を増やさず `<main>` とフッターだけを返す。
 * `SiteChrome` はこれらのページで `main` もフッターも描かない（`siteChrome()` の
 * `main: false`）。フックを持たないので、サーバーコンポーネントからそのまま使える。
 */
export function PublicThemeShell({ themeId, flush = false, children }: PublicThemeShellProps) {
  const theme: SemanticThemeId | null = normalizeSemanticThemeId(themeId);
  // 読み幅は `page--content` が決める（`base.css` の 42rem、テーマ付きは `themes.css` の
  // `--st-content-width`）。`page--narrow` を器に直接付けると、内側で読み幅を持つ
  // ページ（告知・招待・見本の告知）で幅の持ち主が 2 つになるため、器のクラスを分ける。
  const main = (
    <main id="main" className={flush ? "page page--flush page--content" : "page page--content"}>
      {children}
    </main>
  );

  if (!theme) {
    return (
      <>
        {main}
        <SiteFooter />
      </>
    );
  }

  return (
    <div className="semantic-theme semantic-theme--shell" data-semantic-theme={theme}>
      <ThemeTypefaces themeId={theme} />
      {main}
      <SiteFooter />
    </div>
  );
}
