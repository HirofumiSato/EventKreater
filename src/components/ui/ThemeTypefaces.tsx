import { isSemanticThemeId, type SemanticThemeId } from "@/lib/semantic-themes";

/**
 * テーマが追加で読み込む書体。
 *
 * 追加するのは 3 つだけにする。書体を増やすほど、初回表示の待ち時間と、
 * 選ぶときの見比べる負担が増える。用途を「読み物の明朝」「極太の表示」
 * 「手書き風」の 3 つに絞り、テーマはそのどれかを指すだけにする。
 * 色と同じで、書体そのものはここ 1 箇所だけが持つ。
 */
export type FontFamilyKey = "kaisei" | "dela" | "yusei";

/**
 * Google Fonts の family 指定。名前と太さは固定で、変えるときは URL の組み立てごと直す。
 * 並び順は `FONT_FAMILY_ORDER` が決めるので、ここに書く順は問わない。
 */
const FONT_FAMILY_QUERY: Record<FontFamilyKey, string> = {
  kaisei: "Kaisei+Decol:wght@400;500;700",
  dela: "Dela+Gothic+One",
  yusei: "Yusei+Magic",
};

/** URL に並べる順。同じテーマなら常に同じ URL になるよう、書体の定義順ではなくここで固定する。 */
const FONT_FAMILY_ORDER: readonly FontFamilyKey[] = ["kaisei", "dela", "yusei"];

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";

/** テーマごとに読む書体。空配列のテーマは追加の書体を持たない。 */
export const THEME_FONT_FAMILIES: Record<SemanticThemeId, readonly FontFamilyKey[]> = {
  "modern-slate": [],
  "enterprise-clean": [],
  parchment: ["kaisei"],
  "neo-brutalism": ["dela"],
  neon: [],
  washi: [],
  sage: [],
  candy: ["yusei"],
  dusk: [],
  "neon-magenta": [],
  tavern: [],
  kraft: ["yusei"],
  poster: ["dela"],
  spotlight: [],
};

/**
 * そのテーマが必要とする書体だけを 1 本の URL にまとめる。
 *
 * 書体ごとに `<link>` を分けると、テーマを 1 つ選ぶだけでリクエストが増える。
 * 1 本にまとめると、そのテーマで使う書体だけを取りに行ける。
 * 0 件と未知の ID は null を返し、呼び出し側は何も描かない。
 */
export function themeFontHref(themeId: string | null | undefined): string | null {
  if (!isSemanticThemeId(themeId)) return null;

  const needed = THEME_FONT_FAMILIES[themeId];
  const families = FONT_FAMILY_ORDER.filter((key) => needed.includes(key));
  if (families.length === 0) return null;

  const query = families.map((key) => `family=${FONT_FAMILY_QUERY[key]}`).join("&");
  return `${GOOGLE_FONTS_CSS}?${query}&display=swap`;
}

interface ThemeTypefacesProps {
  /** 適用するテーマ。NULL・未知の値なら何も描かない（標準の書体のまま）。 */
  themeId: string | null | undefined;
}

/**
 * テーマが追加で使う書体の `<link>`。
 *
 * テーマを選んだ画面だけが読む（重さ）。全ページで読むと、テーマを使わない
 * 参加者の初回表示まで遅くなるため、`SemanticThemeScope` と `ThemePicker` が
 * テーマの有効なときだけ描く。preconnect は `src/app/layout.tsx` が出している。
 *
 * JavaScript を持たないので、サーバーコンポーネントからそのまま使える。
 */
export function ThemeTypefaces({ themeId }: ThemeTypefacesProps) {
  const href = themeFontHref(themeId);
  if (!href) return null;

  return <link rel="stylesheet" href={href} />;
}
