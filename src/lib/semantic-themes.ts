/**
 * 公開ページのセマンティックテーマ。
 *
 * 色・角・影の実体は `src/styles/themes.css` が正で、ここは ID と表示名だけを持つ。
 * DB には ID（ASCII）を保存し、画面には日本語のラベルを出す。
 * テーマを増やすときは、この配列と CSS の `[data-semantic-theme="..."]` を同じ PR で足す。
 *
 * 主催者プロフィールで使い、将来はイベントの公開ページでも同じ ID を使う。
 * そのため、この 1 箇所だけが ID の一覧を持つ（DB の列挙型にはしない）。
 */

export const SEMANTIC_THEME_IDS = [
  "modern-slate",
  "enterprise-clean",
  "parchment",
  "neo-brutalism",
  "neon",
] as const;

export type SemanticThemeId = (typeof SEMANTIC_THEME_IDS)[number];

export interface SemanticThemeDefinition {
  id: SemanticThemeId;
  label: string;
  /** 選択肢の下に出す 1 行。どんな紙面になるかを、色名ではなく用途で言う。 */
  note: string;
}

export const SEMANTIC_THEMES: readonly SemanticThemeDefinition[] = [
  {
    id: "modern-slate",
    label: "夜のスレート",
    note: "暗い地に白い文字。写真が映え、落ち着いて読めます。",
  },
  {
    id: "enterprise-clean",
    label: "クリーン",
    note: "明るい地に細い枠。どんな催しにも合わせやすい標準的な見た目。",
  },
  {
    id: "parchment",
    label: "羊皮紙",
    note: "生成りの地に明朝。読み物として、ゆっくり読ませたいとき。",
  },
  {
    id: "neo-brutalism",
    label: "ネオ・ブルータリズム",
    note: "太い黒枠と硬い影。手づくりのチラシらしい勢いが出ます。",
  },
  {
    id: "neon",
    label: "ネオン",
    note: "黒地にシアンの発光。クラブ・ライブ・夜の催し向け。",
  },
];

/** 保存されている値が一覧のどれか。壊れた値は落とす。 */
export function isSemanticThemeId(value: string | null | undefined): value is SemanticThemeId {
  return typeof value === "string" && (SEMANTIC_THEME_IDS as readonly string[]).includes(value);
}

/** DB の値を画面で使える ID に寄せる。未知・空・NULL は「標準（null）」にする。 */
export function normalizeSemanticThemeId(
  value: string | null | undefined,
): SemanticThemeId | null {
  return isSemanticThemeId(value) ? value : null;
}

/** テーマの定義。未知の ID は null。 */
export function semanticTheme(themeId: string | null | undefined): SemanticThemeDefinition | null {
  if (!isSemanticThemeId(themeId)) return null;
  return SEMANTIC_THEMES.find((theme) => theme.id === themeId) ?? null;
}
