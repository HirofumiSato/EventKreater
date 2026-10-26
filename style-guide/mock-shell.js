/*
 * モックの帯。製品へは移さない。
 *
 * `npm run mock:sync` が各モックの末尾に
 *
 *   <script src="mock-shell.js" defer data-mock-shell data-file="mock-home.html" ...>
 *
 * を差し込む（scripts/lib/mock-html.mjs の withMockShell）。この file は data 属性を読み、
 * 画面一覧・幅・HTML への行き来を body の末尾に組み立てる。
 *
 * HTML に焼き込まず、ここで組み立てるのは 2 つ理由がある。
 *
 *   1. 帯の文言や並びを 1 か所で直せる（33 ファイルを撮り直さずに済む）
 *   2. 生成物が「製品の DOM + 帯 1 行」に留まり、製品との差分が読みやすい
 *
 * 枠（mock-frame.html）の中では出さない。枠は本文だけを見るためのもの。
 * 一覧（mock-index.html）では data-name が無いので帯を作らないが、
 * 「名前を押したときに開く幅」の切り替えだけは引き受ける。
 */
(function () {
  const script = document.querySelector("script[data-mock-shell]");
  const params = new URLSearchParams(location.search);
  const embedded = params.get("embed") === "1";

  if (embedded) {
    // 枠の中で本文だけを見せる。余白も帯のぶん空けない。
    document.documentElement.classList.add("is-embed");
  } else if (script && script.dataset.name) {
    document.body.append(bar(script.dataset));
    document.documentElement.classList.add("has-mockbar");
  }

  // 一覧の「名前を押したときの幅」。要素が無い画面では何もしない。
  wireOpenWidth();

  /** 帯そのもの。値を textContent で入れるのは、画面名に記号が入っても崩れないようにするため。 */
  function bar(data) {
    const root = document.createElement("div");
    root.className = "mockbar";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "モックの切り替え");

    // 帯が出るのは画面のモックだけ（一覧は data-name を持たない）。自分自身を指す心配はない。
    root.append(link("← 画面一覧", "mock-index.html", "モックの一覧へ戻る"));

    const widths = [
      ["スマホ 390", data.frame390, "390px の枠で開き直す"],
      ["PC 1280", data.frame1280, "1280px の枠で開き直す"],
    ];
    for (const [label, href, title] of widths) {
      if (!href) continue;
      root.append(link(label, href, title));
    }

    if (data.file) root.append(link("HTML", data.file, "帯の無いモックをそのまま開く"));

    const name = document.createElement("span");
    name.className = "mockbar__label";
    name.textContent = data.name;
    root.append(name);

    if (data.path) {
      const path = document.createElement("span");
      path.className = "mockbar__path";
      path.textContent = data.path;
      root.append(path);
    }

    return root;
  }

  function link(label, href, title) {
    const node = document.createElement("a");
    node.className = "mockbar__home";
    node.href = href;
    if (title) node.title = title;
    node.textContent = label;
    return node;
  }

  /**
   * 一覧の `[data-open-width]` を押したら、`[data-screen-link]` の `data-frame` に幅を足す。
   * 行ごとの「スマホ」「PC」「HTML」は固定なので、ここでは触らない。
   */
  function wireOpenWidth() {
    const buttons = [...document.querySelectorAll("[data-open-width]")];
    if (buttons.length === 0) return;

    const links = [...document.querySelectorAll("[data-screen-link]")];
    const apply = (width) => {
      for (const node of links) {
        node.href = `${node.dataset.frame}&w=${width}`;
      }
      for (const button of buttons) {
        button.setAttribute("aria-pressed", String(Number(button.dataset.openWidth) === width));
      }
    };

    for (const button of buttons) {
      button.addEventListener("click", () => apply(Number(button.dataset.openWidth)));
    }

    const initial =
      buttons.find((button) => button.getAttribute("aria-pressed") === "true") ?? buttons[0];
    apply(Number(initial.dataset.openWidth));
  }
})();
