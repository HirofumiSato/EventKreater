/**
 * 公開ページのセマンティックテーマ。
 *
 * 色・角・影の実体は `src/styles/themes.css` が正で、ここは ID・表示名・用途グループだけを持つ。
 * DB には ID（ASCII）を保存し、画面には日本語のラベルを出す。
 * テーマを増やすときは、この配列と CSS の `[data-semantic-theme="..."]` を同じ PR で足す。
 *
 * 主催者プロフィールで使い、将来はイベントの公開ページでも同じ ID を使う。
 * そのため、この 1 箇所だけが ID の一覧を持つ（DB の列挙型にはしない）。
 */

/** 選ぶときの手がかり。9 つを 1 列に並べず、用途で 4 つに分ける。 */
export type SemanticThemeGroup = "calm" | "bright" | "night" | "vivid";

export const SEMANTIC_THEME_GROUPS: readonly {
  id: SemanticThemeGroup;
  label: string;
  note: string;
}[] = [
  { id: "calm", label: "落ち着き", note: "読み物・占い・季節の催し" },
  { id: "bright", label: "明るい", note: "相談・勉強会・マルシェ" },
  { id: "vivid", label: "元気", note: "パーティー・子ども連れ・手づくり" },
  { id: "night", label: "夜", note: "ライブ・バー・写真を主役に" },
] as const;

export const SEMANTIC_THEME_IDS = [
  "modern-slate",
  "enterprise-clean",
  "parchment",
  "neo-brutalism",
  "neon",
  "washi",
  "sage",
  "candy",
  "dusk",
] as const;

export type SemanticThemeId = (typeof SEMANTIC_THEME_IDS)[number];

export interface SemanticThemeDefinition {
  id: SemanticThemeId;
  label: string;
  /** 選択肢の下に出す 1 行。どんな紙面になるかを、色名ではなく用途で言う。 */
  note: string;
  /** チップを並べる束。同じ束の中では、色よりも用途が近いものを隣に置く。 */
  group: SemanticThemeGroup;
}

export const SEMANTIC_THEMES: readonly SemanticThemeDefinition[] = [
  {
    id: "parchment",
    label: "羊皮紙",
    note: "生成りの地に明朝。読み物として、ゆっくり読ませたいとき。",
    group: "calm",
  },
  {
    id: "washi",
    label: "和紙と藍",
    note: "和紙の繊維に藍の差し色。季節の催し・占い・手紙のような告知。",
    group: "calm",
  },
  {
    id: "enterprise-clean",
    label: "クリーン",
    note: "明るい地に細い枠。どんな催しにも合わせやすい標準的な見た目。",
    group: "bright",
  },
  {
    id: "sage",
    label: "余白",
    note: "薄い緑灰と影のない面。行長を詰めて、静かに読ませます。",
    group: "bright",
  },
  {
    id: "neo-brutalism",
    label: "ネオ・ブルータリズム",
    note: "墨の枠と紙を重ねた影。手づくりのチラシらしい、落ち着いた勢い。",
    group: "vivid",
  },
  {
    id: "candy",
    label: "キャンディ",
    note: "桃色の地に丸い角。誕生日・タコパ・子ども連れの集まり向け。",
    group: "vivid",
  },
  {
    id: "modern-slate",
    label: "夜のスレート",
    note: "暗い地に白い文字。写真が映え、落ち着いて読めます。",
    group: "night",
  },
  {
    id: "neon",
    label: "ネオン",
    note: "黒地にシアンの発光。クラブ・ライブ・夜の催し向け。",
    group: "night",
  },
  {
    id: "dusk",
    label: "夕暮れ",
    note: "焦げ茶の地に橙の光。夕方のライブ・BBQ・ビアガーデン向け。",
    group: "night",
  },
];

/** 用途グループごとのテーマ。並びは `SEMANTIC_THEMES` の順を保つ。 */
export function themesInGroup(group: SemanticThemeGroup): readonly SemanticThemeDefinition[] {
  return SEMANTIC_THEMES.filter((theme) => theme.group === group);
}

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
