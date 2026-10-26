// モックを端末の幅（390 / 1280）で見るための枠ページを組み立てる純ロジック。
//
// 生成物の HTML は製品の CSS をそのまま抱えているので、iframe に入れて幅を決めれば
// メディアクエリもその幅で効く。`mock-index.html` と同じく `npm run mock:sync` が
// 書き出す生成物で、手では編集しない。
//
// ブラウザも DB も知らない。文字列を組み立てるだけなので、テストから直接呼べる。

/** `mock-frame.html?p=<file>&w=<width>` の形にする。 */
export function frameUrl(file, width) {
  return `mock-frame.html?p=${encodeURIComponent(file)}&w=${width}`;
}

/**
 * 枠の中に読み込む URL。帯を出さないよう `embed=1` を付ける。
 * 枠は本文だけを見るためのものなので、中に帯があると二重になる。
 */
export function frameSrc(file) {
  return `${file}${file.includes("?") ? "&" : "?"}embed=1`;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 枠ページの HTML。
 *
 * @param {object[]} entries manifest の `screens`（no / group / name / label / file / path）
 * @param {{ widths: {width: number, height: number}[], groups?: {key: string, title: string}[] }} options
 * @returns {string}
 */
export function frameHtml(entries, { widths, groups = [] }) {
  const screens = entries.map((entry) => ({
    file: entry.file,
    no: entry.no,
    name: entry.name,
    label: entry.label ?? "",
    path: entry.path ?? "",
    group: entry.group ?? "",
  }));

  // 選択欄は一覧と同じまとまりで並べる。目録に無い group は「その他」へ寄せる。
  const known = groups.map((group) => group.key);
  const buckets = new Map(groups.map((group) => [group.key, { title: group.title, items: [] }]));
  for (const screen of screens) {
    const key = buckets.has(screen.group) ? screen.group : "__other";
    if (!buckets.has(key)) buckets.set(key, { title: "その他", items: [] });
    buckets.get(key).items.push(screen);
  }
  const options = [...buckets.entries()]
    .filter(([, bucket]) => bucket.items.length > 0)
    .map(([, bucket]) => {
      const items = bucket.items
        .map(
          (screen) =>
            `        <option value="${escapeHtml(screen.file)}">${escapeHtml(screen.no)} ${escapeHtml(screen.name)}${screen.label ? `（${escapeHtml(screen.label)}）` : ""}</option>`,
        )
        .join("\n");
      return `      <optgroup label="${escapeHtml(bucket.title)}">\n${items}\n      </optgroup>`;
    })
    .join("\n");

  const sizes = widths.map((size) => size.width);
  const heightOf = Object.fromEntries(widths.map((size) => [size.width, size.height]));
  const sizeLinks = widths
    .map(
      (size, index) =>
        `      <a href="#" data-width="${size.width}" aria-current="${index === 0 ? "true" : "false"}">${size.width === 390 ? "スマホ" : "PC"} ${size.width}</a>`,
    )
    .join("\n");

  // 目録の順（No・状態の順）で前後に送る。端では反対側へ回る。
  const order = screens.map((screen) => screen.file);
  // 枠の中では帯を出さない。URL の組み立てはここ 1 か所（frameSrc）に任せる。
  const sources = Object.fromEntries(screens.map((screen) => [screen.file, frameSrc(screen.file)]));

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>画面モック | 端末の幅で見る</title>
  <style>
    :root { color-scheme: light; --bar: #1c1917; --line: #e7e5e4; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; display: flex; flex-direction: column; font-family: system-ui, sans-serif; color: #1c1917; background: #f0efed; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; padding: .5rem 1rem; background: var(--bar); color: #faf9f7; font-size: .85rem; }
    .bar a { color: #faf9f7; text-decoration: none; opacity: .8; }
    .bar a:hover, .bar a[aria-current="true"] { opacity: 1; text-decoration: underline; }
    .bar__name { font-weight: 600; }
    .bar__path { color: #a8a29e; font-family: ui-monospace, monospace; font-size: .78rem; }
    .bar__group { display: flex; align-items: center; gap: .75rem; margin-left: auto; }
    select { font: inherit; padding: .2rem .35rem; max-width: 22rem; }
    .stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 1rem; }
    .device { position: relative; overflow: hidden; background: #fff; border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(28, 25, 23, .12); }
    iframe { position: absolute; top: 0; left: 0; border: 0; background: #fff; transform-origin: top left; }
    .hint { margin: 0; padding: 0 1rem .75rem; color: #57534e; font-size: .78rem; text-align: center; }
  </style>
</head>
<body>
  <header class="bar">
    <span class="bar__name" id="name">画面</span>
    <span class="bar__path" id="path"></span>
    <div class="bar__group">
      <label>画面
        <select id="pick">
${options}
        </select>
      </label>
      <a href="#" id="prev">← 前</a>
      <a href="#" id="next">次 →</a>
${sizeLinks}
      <a href="#" id="raw">HTML をそのまま開く</a>
      <a href="mock-index.html">一覧</a>
    </div>
  </header>

  <main class="stage" id="stage">
    <div class="device" id="device">
      <iframe id="frame" title="画面モック" src="about:blank"></iframe>
    </div>
  </main>

  <p class="hint">枠の中は製品と同じ CSS で描いています。幅を変えるとメディアクエリもその幅で効きます。← → キーでも画面を送れます。</p>

  <script>
    const SCREENS = ${JSON.stringify(screens, null, 2).replace(/</g, "\\u003c").replace(/\n/g, "\n    ")};
    const SOURCES = ${JSON.stringify(sources, null, 2).replace(/</g, "\\u003c").replace(/\n/g, "\n    ")};
    const HEIGHTS = ${JSON.stringify(heightOf)};
    const params = new URLSearchParams(location.search);
    const widthOf = (value) => (HEIGHTS[value] ? Number(value) : ${sizes[0]});
    const fileOf = (value) => (SCREENS.some((s) => s.file === value) ? value : SCREENS[0]?.file ?? "");

    const frame = document.getElementById("frame");
    const device = document.getElementById("device");
    const stage = document.getElementById("stage");
    const pick = document.getElementById("pick");

    let file = fileOf(params.get("p"));
    let width = widthOf(params.get("w"));

    function urlFor(nextFile, nextWidth) {
      return "mock-frame.html?" + new URLSearchParams({ p: nextFile, w: String(nextWidth) });
    }

    function show() {
      const screen = SCREENS.find((s) => s.file === file);
      const height = HEIGHTS[width];
      frame.src = SOURCES[file] ?? file;
      frame.width = String(width);
      frame.height = String(height);
      document.getElementById("name").textContent = screen ? screen.no + " " + screen.name : file;
      document.getElementById("path").textContent = screen ? screen.path : "";
      pick.value = file;
      document.getElementById("raw").href = file;
      for (const link of document.querySelectorAll("[data-width]")) {
        link.setAttribute("aria-current", Number(link.dataset.width) === width ? "true" : "false");
        link.href = urlFor(file, Number(link.dataset.width));
      }
      const index = SCREENS.findIndex((s) => s.file === file);
      const prev = SCREENS[(index - 1 + SCREENS.length) % SCREENS.length];
      const next = SCREENS[(index + 1) % SCREENS.length];
      document.getElementById("prev").href = urlFor(prev.file, width);
      document.getElementById("next").href = urlFor(next.file, width);
      document.title = (screen ? screen.no + " " + screen.name : file) + " | 画面モック";
      history.replaceState(null, "", urlFor(file, width));
      fit();
    }

    // 1280 を狭い窓でも見られるように、収まる倍率まで縮める。
    function fit() {
      const scale = Math.min(1, (stage.clientWidth - 32) / frame.width, (stage.clientHeight - 24) / frame.height);
      frame.style.transform = "scale(" + scale + ")";
      device.style.width = Math.round(frame.width * scale) + "px";
      device.style.height = Math.round(frame.height * scale) + "px";
    }

    pick.addEventListener("change", () => {
      file = pick.value;
      show();
    });
    for (const link of document.querySelectorAll("[data-width]")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        width = Number(link.dataset.width);
        show();
      });
    }
    addEventListener("keydown", (event) => {
      if (event.target.closest("select, input, textarea")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const index = SCREENS.findIndex((s) => s.file === file);
      file = SCREENS[(index + step + SCREENS.length) % SCREENS.length].file;
      show();
    });
    addEventListener("resize", fit);
    if (SCREENS.length > 0) show();
  </script>
</body>
</html>
`;
}
