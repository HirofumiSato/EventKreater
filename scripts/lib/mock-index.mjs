// モックの一覧（`style-guide/mock-index.html`）を組み立てる純ロジック。
//
// 一覧は製品の画面ではないので、`npm run mock:sync` が manifest から書き出す。
// 見た目は製品の CSS（`assets/<hash>.css`）を読み、クラスも製品のものを使う。
// 一覧にしか無い行の形は `style-guide/mock-guide.css` が持つ。
//
// ここにはブラウザも DB も無い。文字列を受けて文字列を返すだけにして、
// ファイルの読み書きは呼び出し側（`scripts/mock-sync.mjs`）に残す。

import { escapeHtml, frameUrl } from "./mock-frame.mjs";

/** 装飾のスコープ。製品の `SiteChrome` が付けたクラスを、生成した HTML から読む。 */
export function scopeOfHtml(html) {
  // 静かめを先に見る。`deco--tape` は両方に付くので、後ろに置くと取り違える。
  if (/\bdeco--tape-quiet\b/.test(html)) return "quiet";
  if (/\bdeco--tape-shadow\b/.test(html)) return "pop";
  return "none";
}

const SCOPE_LABEL = {
  pop: "影だけ",
  quiet: "静かめ",
  none: "装飾なし",
};

/**
 * 一覧の HTML。
 *
 * @param {object[]} entries manifest の `screens`（no / group / name / label / file / path / note）
 * @param {object} options
 * @param {object[]} options.groups   区分（key / title / note）
 * @param {{width: number, height: number}[]} options.widths
 * @param {string[]} options.stylesheets 製品の CSS（`style-guide/` からの相対）
 * @param {(file: string) => string} [options.scopeOf] 画面ごとの装飾スコープ
 * @returns {string}
 */
export function indexHtml(entries, { groups, widths, stylesheets = [], scopeOf = () => "none" }) {
  const narrow = widths[0];
  const wide = widths[widths.length - 1];
  const first = entries[0]?.file ?? "";

  const sections = groups
    .map((group) => {
      const items = entries.filter((entry) => entry.group === group.key);
      if (items.length === 0) return "";
      return `  <section class="section">
    <div class="section__head">
      <h2 class="section__title">${escapeHtml(group.title)}<span class="screen-group__count">${items.length} 画面</span></h2>
      <p class="section__note">${escapeHtml(group.note ?? "")}</p>
    </div>
    <ul class="screen-list">
${items.map((entry) => rowHtml(entry, { narrow, wide, scopeOf })).join("\n")}
    </ul>
  </section>`;
    })
    .filter(Boolean)
    .join("\n");

  const links = stylesheets
    .map((href) => `  <link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>画面モック一覧</title>
${links}
  <link rel="stylesheet" href="mock-guide.css">
  <link rel="stylesheet" href="mock-shell.css">
</head>
<body class="deco deco--tape deco--tape-shadow">
  <a class="skip-link" href="#main">本文へ</a>

  <header class="site-header">
    <div class="site-header__inner">
      <a class="site-brand" href="mock-index.html">EventKreater</a>
      <div class="site-header__actions">
        <a class="btn btn--outline btn--sm" href="${escapeHtml(frameUrl(first, narrow.width))}">スマホで見る</a>
        <a class="btn btn--primary btn--sm" href="${escapeHtml(frameUrl(first, wide.width))}">PC で見る</a>
      </div>
    </div>
  </header>

  <main id="main" class="page">
    <div class="stack">

      <div>
        <p class="eyebrow">画面モック</p>
        <h1 class="page-title">全 ${entries.length} 画面。</h1>
        <p class="page-lead">
          製品の DOM から <code>npm run mock:sync</code> が書き出した生成物です。手で編集しないでください。
          画面名を押すと枠（iframe）で開きます。幅は下の切り替え、または行ごとの「スマホ」「PC」から選べます。
        </p>
        <div class="panel__actions" style="margin-top: 1rem">
          <a class="btn btn--primary btn--sm" href="mock-frame.html">枠で見る</a>
          <a class="btn btn--outline btn--sm" href="${escapeHtml(frameUrl(first, narrow.width))}">ホーム（スマホ）</a>
        </div>
      </div>

      <p class="device-note">
        既定はスマホ ${narrow.width}px。PC は ${wide.width}px の枠で開きます。枠の中は製品と同じ CSS で描くので、
        メディアクエリもその幅で効きます。撮った PNG（${narrow.width} / ${wide.width}）は <code>storage/mock-shots/</code> にあり、コミットしません。
      </p>

      <div class="guide-segment" role="group" aria-label="名前を押したときに開く幅">
        <span class="guide-segment__label">名前を押したときの幅</span>
        <button class="guide-segment__item" type="button" data-open-width="${narrow.width}" aria-pressed="true">スマホ ${narrow.width}</button>
        <button class="guide-segment__item" type="button" data-open-width="${wide.width}" aria-pressed="false">PC ${wide.width}</button>
      </div>

${sections}

    </div>
  </main>

  <footer class="site-footer">
    <div class="site-footer__inner">
      <p>EventKreater / 画面モック</p>
      <ul class="site-footer__links">
        <li><a href="mock-frame.html">枠で見る</a></li>
        <li><a href="mock-home.html">ホーム</a></li>
        <li><a href="mock-service.html">サービスと料金</a></li>
        <li><a href="mock-terms.html">利用規約</a></li>
      </ul>
    </div>
  </footer>

  <script src="mock-shell.js" defer></script>
</body>
</html>
`;
}

/** 1 画面 = 1 行。状態つきの画面は状態ごとに 1 行になる。 */
function rowHtml(entry, { narrow, wide, scopeOf }) {
  // 幅は `mock-shell.js` が足す。ここでは `&w=` を付けない形で持たせる。
  const frame = `mock-frame.html?p=${encodeURIComponent(entry.file)}`;
  const scope = scopeOf(entry.file);
  const state = entry.label
    ? ` <span class="badge badge--neutral badge--sm">${escapeHtml(entry.label)}</span>`
    : "";

  return `      <li class="screen-row">
        <span class="screen-row__no" aria-hidden="true">${escapeHtml(entry.no)}</span>
        <div>
          <p class="screen-row__title"><a href="${escapeHtml(`${frame}&w=${narrow.width}`)}" data-screen-link data-frame="${escapeHtml(frame)}">${escapeHtml(entry.name)}</a>${state}</p>
          <p class="screen-row__meta"><span class="screen-row__path">${escapeHtml(entry.path ?? "")}</span><span class="scope-tag scope-tag--${scope}">${SCOPE_LABEL[scope]}</span></p>
          <p class="screen-row__note">${escapeHtml(entry.note ?? "")}</p>
          <p class="screen-row__act">
            <a class="btn btn--outline btn--sm" href="${escapeHtml(frameUrl(entry.file, narrow.width))}">スマホ</a>
            <a class="btn btn--ghost btn--sm" href="${escapeHtml(frameUrl(entry.file, wide.width))}">PC</a>
            <a class="btn btn--ghost btn--sm" href="${escapeHtml(entry.file)}">HTML</a>
          </p>
        </div>
      </li>`;
}
