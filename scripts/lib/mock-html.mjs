// 製品の DOM を、そのまま開けるモックの HTML に整える純ロジック。
//
//   scripts/mock-sync.mjs  … ブラウザで開いた HTML を、ここに通して書き出す
//   tests/unit/mock-sync.test.mjs … この中の関数を直接呼ぶ
//
// ここには DOM もブラウザも無い。文字列を受けて文字列を返すだけにして、
// 取得（fetch）と保存（writeFile）は呼び出し側に残す。テストで固定できるようにするため。

import { createHash } from "node:crypto";

/** 生成物の先頭に付ける注意書き。手で直したときに気づけるようにする。 */
export function noticeFor({ name, path }) {
  return [
    "<!--",
    "  生成物です。手で編集しないでください。",
    "  `npm run mock:sync` が製品の DOM から書き出します。",
    `  画面: ${name}（${path}）`,
    "  製品を直したら、同じ PR で `npm run mock:sync` を回してください。",
    "-->",
  ].join("\n");
}

/**
 * 開いたままにすると動かないもの・邪魔になるものを落とす。
 *
 * - `<script>`（モックは静的な写しなので、水和も計測も要らない）
 * - HTML コメント（Next が差し込む区切り）
 * - `nonce` / `data-nextjs-*`（実行のたびに変わる。残すと差分が出る）
 * - `<next-route-announcer>`（App Router の読み上げ用。見た目に出ない）
 */
export function sanitizeHtml(html) {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/<next-route-announcer\b[^>]*>[\s\S]*?<\/next-route-announcer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+nonce="[^"]*"/gi, "")
    .replace(/\s+data-nextjs-[a-z0-9-]+(?:="[^"]*")?/gi, "");

  // 実行に要る Next の内部ファイル（preload / modulepreload / prefetch）は落とす。
  // stylesheet はこのあと `assets/` へ差し替えるので残す。
  return withoutScripts.replace(/<link\b[^>]*>/gi, dropNextOnlyLink).trim();
}

function dropNextOnlyLink(tag) {
  if (/\brel="stylesheet"/i.test(tag)) return tag;
  // 先読みは、モックでは全部そろっている（CSS は assets/、画像は assets/）。
  // 残すと開くたびに存在しない `/_next/` を叩く。
  if (/\brel="(?:preload|modulepreload|prefetch)"/i.test(tag)) return "";
  const href = attributeOf(tag, "href");
  if (href && decodeEntities(href).startsWith("/_next/")) return "";
  return tag;
}

/** 先頭に注意書きを足す。doctype が無ければ補う（無いと後方互換モードで描画される）。 */
export function withNotice(html, meta) {
  const notice = noticeFor(meta);
  const withDoctype = /^<!doctype html>/i.test(html) ? html : `<!doctype html>\n${html}`;
  return withDoctype.replace(/^<!doctype html>/i, (match) => `${match}\n${notice}`);
}

/**
 * モックだけが持つ帯（画面一覧・幅・HTML への行き来）を差し込む。
 *
 * 帯は製品に無いので、製品の DOM を写すだけでは消える。ここで毎回足すことで、
 * 次に誰が `npm run mock:sync` を回しても残る。**sanitizeHtml のあとに呼ぶこと。**
 * 先に呼ぶと、製品側の `<script>` を落とす処理に巻き込まれる。
 *
 * 中身は `style-guide/mock-shell.js` が data 属性から組み立てる。HTML に焼き込まないのは、
 * 帯の文言や並びを 1 か所（js）で直せるようにするため。
 */
export function withMockShell(html, { file = "", name = "", path = "", frame390 = "", frame1280 = "" } = {}) {
  if (html.includes("data-mock-shell")) return html;

  const data = [
    "data-mock-shell",
    `data-file="${escapeAttribute(file)}"`,
    `data-name="${escapeAttribute(name)}"`,
    `data-path="${escapeAttribute(path)}"`,
    `data-frame390="${escapeAttribute(frame390)}"`,
    `data-frame1280="${escapeAttribute(frame1280)}"`,
  ].join(" ");
  const script = `<script src="mock-shell.js" defer ${data}></script>`;
  const stylesheet = '<link rel="stylesheet" href="mock-shell.css">';

  const withStylesheet = insertBeforeClosing(html, "head", stylesheet);
  return insertBeforeClosing(withStylesheet, "body", script);
}

/**
 * モック専用の操作（`style-guide/mock-interactions.js`）を読み込ませる。
 *
 * 製品の DOM は水和済みの写しなので、ボタンを押しても何も起きない。モックでは
 * 遷移・開閉・音声入力の流れをなぞれるようにしたいので、帯の script の直後に 1 行足す。
 * どちらも `defer` なので、HTML に書いた順で動く（帯が先、操作が後）。
 *
 * **`withMockShell` のあとに呼ぶこと。** 帯より先に置くと、帯の script を探す側が
 * 見つけられない（`mock-shell.js` が無い HTML では body の末尾へ足す）。
 */
export function withMockInteractions(html) {
  if (html.includes("mock-interactions.js")) return html;
  const script = '<script src="mock-interactions.js" defer></script>';
  const shell = /<script\b[^>]*src="mock-shell\.js"[^>]*><\/script>/i;
  if (shell.test(html)) return html.replace(shell, (tag) => `${tag}\n  ${script}`);
  return insertBeforeClosing(html, "body", script);
}

/** 閉じタグの直前に 1 行足す。閉じタグが無ければ開きタグの直後に置く。 */
function insertBeforeClosing(html, tag, content) {
  const closing = new RegExp(`</${tag}>`, "i");
  if (closing.test(html)) return html.replace(closing, `  ${content}\n</${tag}>`);

  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i");
  if (open.test(html)) return html.replace(open, (match) => `${match}\n  ${content}`);
  return html;
}

/** 読み込む CSS の href。Next が吐いた `<link rel="stylesheet">` を拾う。 */
export function stylesheetHrefs(html) {
  const hrefs = [];
  const pattern = /<link\b[^>]*>/gi;
  for (const [tag] of html.matchAll(pattern)) {
    if (!/\brel="stylesheet"/i.test(tag)) continue;
    const href = attributeOf(tag, "href");
    if (href) hrefs.push(decodeEntities(href));
  }
  return [...new Set(hrefs)];
}

/** 取得して差し替える画像の URL。`src` と `srcset` の両方から集める。 */
export function imageSources(html) {
  const urls = [];
  for (const tag of imgTags(html)) {
    const src = attributeOf(tag, "src");
    if (src) urls.push(decodeEntities(src));
    const srcset = attributeOf(tag, "srcset");
    if (srcset) urls.push(...parseSrcset(decodeEntities(srcset)).map((entry) => entry.url));
  }
  return [...new Set(urls)];
}

/**
 * CSS と画像の参照を、保存した場所へ差し替える。
 * 対応表に無い URL（取得に失敗したもの・外部のもの）は元のまま残す。
 */
export function applyAssetMap(html, { stylesheets = new Map(), images = new Map() } = {}) {
  let next = html;

  if (stylesheets.size > 0) {
    next = next.replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/\brel="stylesheet"/i.test(tag)) return tag;
      const href = attributeOf(tag, "href");
      if (!href) return tag;
      const saved = stylesheets.get(decodeEntities(href));
      return saved ? replaceAttribute(tag, "href", saved) : tag;
    });
  }

  if (images.size > 0) {
    next = next.replace(/<(?:img|source)\b[^>]*>/gi, (tag) => {
      let out = tag;
      const srcset = attributeOf(out, "srcset");
      if (srcset) {
        const rewritten = parseSrcset(decodeEntities(srcset))
          .map((entry) => {
            const saved = images.get(entry.url);
            return `${saved ?? entry.url}${entry.descriptor ? ` ${entry.descriptor}` : ""}`;
          })
          .join(", ");
        out = replaceAttribute(out, "srcset", rewritten);
      }
      const src = attributeOf(out, "src");
      if (src) {
        const saved = images.get(decodeEntities(src));
        if (saved) out = replaceAttribute(out, "src", saved);
      }
      return out;
    });
  }

  return next;
}

/**
 * 内部リンクを、対応するモックへ向ける。対応表に無いものは `#` にする。
 *
 * 対応表のキーは完全一致のパスのほかに、`*` を 1 セグメントとして持つ型も使える
 * （`/organizer/events/<id>/edit` に対する `/organizer/events/<任意>/edit` のような形）。
 * 催しの ID は撮るたびに変わるので、完全一致だけでは「編集」「参加者を見る」が
 * 全部 `#` になっていた。
 */
export function rewriteInternalLinks(html, targets) {
  return html.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = attributeOf(tag, "href");
    if (href === null) return tag;
    const raw = decodeEntities(href).trim();
    if (raw === "") return replaceAttribute(tag, "href", "#");
    if (isExternalOrAnchor(raw)) return tag;

    const pathname = raw.split("?")[0].split("#")[0] || "/";
    const target = matchLinkTarget(pathname, targets);
    return replaceAttribute(tag, "href", target ?? "#");
  });
}

/**
 * パスに合うモックを探す。完全一致を先に見て、無ければ `*` の型と比べる。
 *
 * 型はセグメント数が同じものだけを比べ、`*` が少ない（文字が合うところが多い）型を選ぶ。
 * `events` の 1 階層だけの型と、その下の `receipt` まで含む型は長さが違うので取り違えない。
 */
export function matchLinkTarget(pathname, targets) {
  const exact = targets.get(pathname);
  if (exact) return exact;

  const segments = pathSegments(pathname);
  let best = null;
  let bestLiteral = -1;
  for (const [pattern, file] of targets) {
    if (!pattern.includes("*")) continue;
    const patternSegments = pathSegments(pattern);
    if (patternSegments.length !== segments.length) continue;

    let literal = 0;
    let matched = true;
    for (let index = 0; index < segments.length; index += 1) {
      if (patternSegments[index] === "*") continue;
      if (patternSegments[index] !== segments[index]) {
        matched = false;
        break;
      }
      literal += 1;
    }
    if (!matched) continue;
    if (literal > bestLiteral) {
      best = file;
      bestLiteral = literal;
    }
  }
  return best ?? null;
}

/** パスをセグメントに分ける。末尾の `/` は無視する（`/a/` と `/a` を同じに扱う）。 */
function pathSegments(pathname) {
  return pathname.split("/").filter((segment) => segment !== "");
}

/** 外部リンク・ページ内アンカー・特殊スキームは触らない。 */
export function isExternalOrAnchor(href) {
  return (
    href.startsWith("#") ||
    href.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(href)
  );
}

/** 保存したアセットの名前。内容が同じなら同じ名前になる（再実行で差分を出さない）。 */
export function assetName(content, extension) {
  return `${createHash("sha256").update(content).digest("hex").slice(0, 16)}${extension}`;
}

/** Content-Type から拡張子を決める。分からなければ `.bin`。 */
export function extensionFor(contentType = "") {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const table = {
    "text/css": ".css",
    "image/webp": ".webp",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "image/x-icon": ".ico",
    "font/woff2": ".woff2",
    "font/woff": ".woff",
  };
  return table[type] ?? ".bin";
}

/** 属性の値。無ければ null（空文字と区別する）。 */
export function attributeOf(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function replaceAttribute(tag, name, value) {
  const pattern = new RegExp(`(\\s${name}=")[^"]*(")`, "i");
  if (pattern.test(tag)) return tag.replace(pattern, `$1${escapeAttribute(value)}$2`);
  return tag.replace(/\s*\/?>$/, (end) => ` ${name}="${escapeAttribute(value)}"${end}`);
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function imgTags(html) {
  return [...html.matchAll(/<(?:img|source)\b[^>]*>/gi)].map(([tag]) => tag);
}

/** `url 1x, url 390w` を、URL と説明（`1x` など）に分ける。 */
export function parseSrcset(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, descriptor] = part.split(/\s+/, 2);
      return { url, descriptor: descriptor ?? "" };
    });
}
