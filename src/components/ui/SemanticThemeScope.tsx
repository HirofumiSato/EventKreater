import type { ReactNode } from "react";
import { normalizeSemanticThemeId, type SemanticThemeId } from "@/lib/semantic-themes";

interface SemanticThemeScopeProps {
  /** 保存されているテーマ。NULL・未知の値なら何も包まない（標準の見た目）。 */
  themeId: string | null | undefined;
  children: ReactNode;
  /**
   * 公開ページの地を画面幅いっぱいに広げるか。
   * 編集画面のプレビューのように、すでに枠の中にあるときは false にする。
   */
  page?: boolean;
}

/**
 * セマンティックテーマの適用範囲。
 *
 * 色は `src/styles/themes.css` が `data-semantic-theme` 属性から決める。
 * ここは属性を 1 つ出すだけで、JavaScript を持たない（サーバーコンポーネントから使える）。
 *
 * テーマ未選択（NULL）のときは要素を増やさず、そのまま children を返す。
 * 既存のページの DOM と見た目を変えないため。
 */
export function SemanticThemeScope({ themeId, children, page = false }: SemanticThemeScopeProps) {
  const theme: SemanticThemeId | null = normalizeSemanticThemeId(themeId);
  if (!theme) return <>{children}</>;

  return (
    <div
      className={page ? "semantic-theme semantic-theme--page" : "semantic-theme"}
      data-semantic-theme={theme}
    >
      {children}
    </div>
  );
}
