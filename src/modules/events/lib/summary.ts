/**
 * イベント概要（リッチテキスト）の純ロジック。
 *
 * サーバーとブラウザの両方から import するため、Node 専用の API は使わない。
 * HTML の無害化（`sanitize-html`）はサーバー専用の `summary-html.ts` に置き、
 * ここでは「表示文字数をどう数えるか」だけを決める。
 */

/** 概要の表示文字数の上限。タグと改行は数えない。 */
export const EVENT_SUMMARY_MAX_LENGTH = 200;

/** 改行に置き換えるブロック要素。段落・リスト・見出しの境界で行を分ける。 */
const BLOCK_BOUNDARY_PATTERN = /<\/?\s*(?:p|div|li|ul|ol|blockquote|h[1-6])\b[^>]*>/gi;

/** 実体参照を 1 回だけ復号するための表。`&amp;` の二回復号を避ける。 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  middot: "・",
};

/** 名前付き・数値の実体参照を復号する。知らない名前はそのまま残す。 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * 空白と改行を 1 つの決まった形へそろえる。
 * 数えるときも表示するときもこの関数を通すので、両者の文字数は必ず一致する。
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // タブ・全角空白・改行なしの空白は半角 1 つにまとめる。
    .replace(/[\t\f\v\u00a0\u3000]/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n +/g, "\n")
    .replace(/ {2,}/g, " ")
    // 段落の境界が重なってできる空行は畳む。改行自体は文字数に数えない。
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * 概要の HTML から表示用のテキストを作る。
 *
 * - `<br>` とブロック要素の境界は改行にする
 * - タグは取り除き、実体参照（`&amp;` など）は復号する
 * - 連続する空白・空行は 1 つにそろえる
 *
 * 文字数を数えるときも表示するときもこの結果を使う。
 */
export function summaryText(html: string): string {
  if (!html) return "";
  const withoutHidden = html
    // script/style の中身は表示されないので、数える前に丸ごと落とす。
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(BLOCK_BOUNDARY_PATTERN, "\n");
  const withoutTags = withoutHidden.replace(/<[^>]*>/g, "");
  return normalizeWhitespace(decodeHtmlEntities(withoutTags));
}

/**
 * 概要の表示文字数。タグと改行は数えない。
 * 改行は 0 文字として扱い、結合後の文字だけを数える（絵文字は 1 文字）。
 */
export function summaryTextLength(html: string): number {
  return [...summaryText(html).replace(/\n/g, "")].length;
}

/**
 * プレーンテキストを概要の HTML にする。エディタへの貼り付けで使う。
 * 改行は `<br>` にする。
 */
export function escapeSummaryHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}

/**
 * 概要のリンク先を検証する。`http` / `https` だけを通す。
 *
 * - スキームを省略した入力（`example.com`）は `https://` を補う
 * - `javascript:` / `data:` / `mailto:` / `tel:` などは null
 * - 空白や制御文字を含む入力は URL として扱わない
 */
export function normalizeSummaryLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // 途中に空白・制御文字が混ざるものは URL にしない（`java script:` のような迂回も防ぐ）。
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return null;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  let candidate: string;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    candidate = trimmed;
  } else {
    // スキーム省略。`//example.com` のようなプロトコル相対も https に寄せる。
    candidate = `https://${trimmed.replace(/^\/\//, "")}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname === "") return null;
    // 入力しやすい形を保つため、URL パーサーの正規化結果ではなく入力に近い文字列を返す。
    return schemeMatch ? trimmed : `https://${trimmed.replace(/^\/\//, "")}`;
  } catch {
    return null;
  }
}
