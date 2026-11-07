import { isSemanticThemeId, type SemanticThemeId } from "@/lib/semantic-themes";

/**
 * テーマが追加で読み込む書体。
 *
 * 1 テーマにつき 2 ファミリーまで。見出しと本文で同じファミリーを使うなら、
 * ウェイト差で性格を出す（`modern-slate` の M PLUS 1p は見出し 800 / 本文 400）。
 * 3 つ目を足すと、テーマを選ぶだけで取りに行く書体が増え、初回表示が遅くなる。
 * 色と同じで、書体そのものはここ 1 箇所だけが持つ。
 */
export type FontFamilyKey =
  | "kaisei"
  | "dela"
  | "yusei"
  | "mplus1p"
  | "mplusRounded"
  | "notoSerif"
  | "notoSans"
  | "bizUd"
  | "shippori"
  | "zenKakuExtra"
  | "zenMaruBody";

/**
 * Google Fonts の family 指定。名前と太さは固定で、変えるときは URL の組み立てごと直す。
 * 並び順は `FONT_FAMILY_ORDER` が決めるので、ここに書く順は問わない。
 *
 * `zenKakuExtra` / `zenMaruBody` は、`src/app/layout.tsx`（base）が全ページで読む
 * Zen Kaku Gothic New / Zen Maru Gothic のうち、**テーマで足りないウェイトだけ**を持つ。
 * base と重複するウェイトを載せると、同じ書体を二重に取りに行く。
 */
const FONT_FAMILY_QUERY: Record<FontFamilyKey, string> = {
  kaisei: "Kaisei+Decol:wght@400;500;700",
  dela: "Dela+Gothic+One",
  yusei: "Yusei+Magic",
  mplus1p: "M+PLUS+1p:wght@400;600;800",
  mplusRounded: "M+PLUS+Rounded+1c:wght@400;700",
  notoSerif: "Noto+Serif+JP:wght@400;700",
  notoSans: "Noto+Sans+JP:wght@400;900",
  bizUd: "BIZ+UDPGothic:wght@400;700",
  shippori: "Shippori+Mincho:wght@400;600",
  // base は Zen Kaku 400;500;700。ネオンの見出し 900 だけを足す。
  zenKakuExtra: "Zen+Kaku+Gothic+New:wght@900",
  // base は Zen Maru 500;700。本文で使う 400 だけを足す。
  zenMaruBody: "Zen+Maru+Gothic:wght@400",
};

/** URL に並べる順。同じテーマなら常に同じ URL になるよう、書体の定義順ではなくここで固定する。 */
const FONT_FAMILY_ORDER: readonly FontFamilyKey[] = [
  "kaisei",
  "dela",
  "yusei",
  "mplus1p",
  "mplusRounded",
  "notoSerif",
  "notoSans",
  "bizUd",
  "shippori",
  "zenKakuExtra",
  "zenMaruBody",
];

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";

/** テーマの見出しと本文が、追加で読む書体。 */
export interface ThemeFontPair {
  heading: FontFamilyKey | null;
  body: FontFamilyKey | null;
}

/**
 * テーマごとに追加で読む書体。`null` は「テーマでは何も足さない」の意。
 *
 * 次の 3 つは追加読み込みが要らないので `null` にする。CSS のスタックは
 * 実際に使う書体を書いたうえで、読み込みだけを base に任せる。
 *
 * - base の書体をそのまま使う（`neo-brutalism` / `spotlight` の本文 Zen Kaku 400）
 * - base の書体を見出しに使う（`sage` の見出し Zen Maru 500）
 * - 端末の明朝を使う（`tavern` / `spotlight` の見出し）
 */
export const THEME_FONTS: Record<SemanticThemeId, ThemeFontPair> = {
  "modern-slate": { heading: "mplus1p", body: "mplus1p" },
  "enterprise-clean": { heading: "bizUd", body: "bizUd" },
  parchment: { heading: "kaisei", body: "notoSerif" },
  "neo-brutalism": { heading: "dela", body: null },
  neon: { heading: "zenKakuExtra", body: null },
  washi: { heading: "shippori", body: "shippori" },
  // 見出しは base の Zen Maru 500。本文の 400 だけを足す。
  sage: { heading: null, body: "zenMaruBody" },
  candy: { heading: "yusei", body: "mplusRounded" },
  dusk: { heading: "mplusRounded", body: "mplusRounded" },
  "neon-magenta": { heading: "notoSans", body: "notoSans" },
  tavern: { heading: null, body: "zenMaruBody" },
  kraft: { heading: "yusei", body: "zenMaruBody" },
  poster: { heading: "dela", body: "mplus1p" },
  // 見出しは端末の明朝、本文は base の Zen Kaku 400。
  spotlight: { heading: null, body: null },
};

/**
 * そのテーマが必要とする書体だけを 1 本の URL にまとめる。
 *
 * 書体ごとに `<link>` を分けると、テーマを 1 つ選ぶだけでリクエストが増える。
 * 1 本にまとめると、そのテーマで使う書体だけを取りに行ける。
 * 重複するファミリー（見出しと本文が同じ）は 1 エントリに畳む。
 * 0 件と未知の ID は null を返し、呼び出し側は何も描かない。
 */
export function themeFontHref(themeId: string | null | undefined): string | null {
  if (!isSemanticThemeId(themeId)) return null;

  const fonts = THEME_FONTS[themeId];
  const needed = new Set<FontFamilyKey>();
  if (fonts.heading) needed.add(fonts.heading);
  if (fonts.body) needed.add(fonts.body);

  const families = FONT_FAMILY_ORDER.filter((key) => needed.has(key));
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
