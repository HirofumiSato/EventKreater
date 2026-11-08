/**
 * イベント概要の HTML を無害化する（サーバー専用）。
 *
 * `sanitize-html` は Node 向けの実装なので、このモジュールはクライアントから import しない。
 * 呼び出すのは API の受け口（`src/lib/schemas.ts` の `eventBodySchema`）だけにする。
 * 表示側は保存済みの HTML をそのまま描くため、保存の前にここで必ず通す。
 */
import sanitizeHtml from "sanitize-html";
import { normalizeSummaryLinkUrl } from "@/modules/events/lib/summary";

/** 概要で使えるタグ。太字・斜体・下線・段落・改行・箇条書き・リンクだけ。 */
const ALLOWED_TAGS = [
  "b",
  "strong",
  "i",
  "em",
  "u",
  "p",
  "div",
  "br",
  "ul",
  "ol",
  "li",
  "a",
  "span",
];

/**
 * 概要の HTML を許可タグだけに絞る。
 *
 * - `script` / `style` / `on*` 属性は落とす（`sanitize-html` の既定に任せる）
 * - `a` の `href` は `normalizeSummaryLinkUrl` で検証する
 * - 有効なリンクには `target="_blank"` と `rel="noopener noreferrer nofollow"` を必ず付ける
 * - 不正な URL のリンクは `span` にして、文字だけを残す
 */
export function sanitizeEventSummary(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    // style・class・on* は許可しない。`a` の属性は下の transformTags で組み直す。
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: { a: ["http", "https"] },
    // `//example.com` のようなプロトコル相対は受け付けない。
    allowProtocolRelative: false,
    transformTags: {
      a: (
        _tagName: string,
        attribs: Record<string, string>,
      ): { tagName: string; attribs: Record<string, string> } => {
        const href = normalizeSummaryLinkUrl(attribs.href ?? "");
        if (!href) {
          // リンクとして成立しない URL は、文字を消さずに span へ置き換える。
          return { tagName: "span", attribs: {} };
        }
        return {
          tagName: "a",
          attribs: {
            href,
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        };
      },
    },
  }).trim();
}
