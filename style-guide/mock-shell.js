/*
 * 画面モックの共通の外枠。製品へは移さない。
 *
 * 各ページは本文（<main>）だけを書き、ヘッダー・フッター・切り替え帯はここが出す。
 * こうしておくと、ナビの出し分け（未ログイン / 参加者 / 主催者）を 1 か所で直せる。
 *
 * <body
 *   data-screen="参加者ホーム"        切り替え帯に出す画面名
 *   data-path="/participant"         実装でのパス（表示だけ）
 *   data-nav="public|participant|organizer"
 *   data-current="participant"       ナビの現在地のキー
 *   data-scope="onboard|admin"       装飾の既定（mock-theme.js が読む）
 *   data-chrome="bare"               共通ヘッダーを出さない（主催者の独自ページ）
 * >
 */
(function () {
  const file = location.pathname.split("/").pop() || "mock-index.html";
  const body = document.body;
  const nav = body.dataset.nav || "public";
  const current = body.dataset.current || "";
  const screen = body.dataset.screen || "";
  const path = body.dataset.path || "";
  // 告知ページは主催者の独自ページに見せたいので、共通ヘッダーを出さない。
  const bare = body.dataset.chrome === "bare";

  const NAVS = {
    public: [
      { key: "service", label: "サービスと料金", href: "mock-service.html" },
      { key: "participant-login", label: "参加者ログイン", href: "mock-participant-login.html" },
    ],
    participant: [
      { key: "participant", label: "参加者ホーム", href: "mock-participant.html" },
      { key: "participant-calendar", label: "参加カレンダー", href: "mock-participant-calendar.html" },
      { key: "participant-history", label: "参加履歴", href: "mock-participant-history.html" },
      { key: "account", label: "アカウント", href: "mock-account.html" },
      { key: "mypage", label: "主催者として使う", href: "mock-mypage.html" },
    ],
    organizer: [
      { key: "organizer", label: "主催一覧", href: "mock-organizer.html" },
      { key: "create", label: "イベント告知ページを作る", href: "mock-create.html" },
      { key: "mypage", label: "主催者マイページ", href: "mock-mypage.html" },
      { key: "account", label: "アカウント", href: "mock-account.html" },
      { key: "participant", label: "参加者として見る", href: "mock-participant.html" },
    ],
  };

  const ACTIONS = {
    public: {
      primary: { label: "イベント告知ページを作る", href: "mock-create.html" },
      secondary: { label: "主催者ログイン", href: "mock-register.html" },
    },
    participant: {
      primary: { label: "参加者ホーム", href: "mock-participant.html" },
      secondary: { label: "アカウント", href: "mock-account.html" },
    },
    organizer: {
      primary: { label: "イベントを作る", href: "mock-create.html" },
      secondary: { label: "主催一覧", href: "mock-organizer.html" },
    },
  };

  function link(item) {
    const isCurrent = item.key === current;
    return `<a class="site-nav__link${isCurrent ? " is-current" : ""}" href="${item.href}"${
      isCurrent ? ' aria-current="page"' : ""
    }>${item.label}</a>`;
  }

  function header() {
    const items = NAVS[nav] || NAVS.public;
    const actions = ACTIONS[nav] || ACTIONS.public;
    return `
  <header class="site-header">
    <div class="site-header__inner">
      <a class="site-brand" href="mock-index.html">EventKreater</a>
      <nav id="site-nav" class="site-nav" aria-label="サイト">
        <div class="site-nav__action">
          <a class="btn btn--outline btn--sm btn--block" href="${actions.secondary.href}">${actions.secondary.label}</a>
        </div>
        ${items.map(link).join("\n        ")}
      </nav>
      <div class="site-header__actions">
        <a class="btn btn--primary btn--sm" href="${actions.primary.href}">${actions.primary.label}</a>
        <a class="btn btn--outline btn--sm site-header__action" href="${actions.secondary.href}">${actions.secondary.label}</a>
        <button class="site-menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="メニュー">
          <span class="site-menu-toggle__bar" aria-hidden="true"></span>
          <span class="site-menu-toggle__bar" aria-hidden="true"></span>
          <span class="site-menu-toggle__bar" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </header>`;
  }

  function footer() {
    return `
  <footer class="site-footer">
    <div class="site-footer__inner">
      <p>EventKreater</p>
      <ul class="site-footer__links">
        <li><a href="mock-index.html">画面一覧</a></li>
        <li><a href="mock-service.html">サービスと料金</a></li>
        <li><a href="mock-terms.html">利用規約</a></li>
        <li><a href="mock-create.html">イベント告知ページを作る</a></li>
      </ul>
    </div>
  </footer>`;
  }

  function decoNow() {
    if (body.classList.contains("deco--tape-quiet")) return "tape-quiet";
    if (body.classList.contains("deco--tape-shadow")) return "tape-shadow";
    return "base";
  }

  function bar() {
    const deco = decoNow();
    const frame = (w) => `mock-frame.html?p=${encodeURIComponent(file)}&w=${w}&t=${deco}`;
    const pressed = (key) =>
      `<button type="button" data-deco-btn="${key}" aria-pressed="${deco === key}">${
        { "tape-shadow": "影だけ", "tape-quiet": "静かめ", base: "現行" }[key]
      }</button>`;
    return `
  <div class="mockbar" role="group" aria-label="モックの切り替え">
    <a class="mockbar__home" href="mock-index.html">← 一覧</a>
    <a class="mockbar__home" href="mock-compare.html">比較</a>
    <a class="mockbar__home" href="${frame(390)}" title="390px の枠で開き直す">スマホ枠</a>
    <span class="mockbar__label">${screen}</span>
    <details class="mockbar__more">
      <summary>表示</summary>
      <div class="mockbar__panel">
        <div class="mockbar__group">
          <span>幅</span>
          <a class="mockbar__home" href="${frame(390)}">スマホ 390</a>
          <a class="mockbar__home" href="${frame(1280)}">PC 1280</a>
        </div>
        <div class="mockbar__group">
          <span>装飾</span>
          ${pressed("tape-shadow")}${pressed("tape-quiet")}${pressed("base")}
        </div>
        ${path ? `<span class="mockbar__path">${path}</span>` : ""}
      </div>
    </details>
  </div>`;
  }

  // 旧ページが持っている帯は取り除く。二重に出さない。
  for (const old of document.querySelectorAll(".mockbar")) old.remove();

  const main = document.getElementById("main");
  if (main) {
    // すでにヘッダーを持つページ（先に作ったモック）は、そのまま使う。
    if (!bare && !document.querySelector(".site-header")) {
      main.insertAdjacentHTML("beforebegin", header());
    }
    if (!document.querySelector(".site-footer")) {
      main.insertAdjacentHTML("afterend", footer());
    }
    document.body.insertAdjacentHTML("beforeend", bar());
  }

  // 帯の分だけ下を空ける。最後の行が隠れないようにする。
  document.documentElement.classList.add("has-mockbar");

  // 装飾ボタンは mock-theme.js が拾うので、ここでは何もしない。
  // 帯の中の details は、外側を押したら閉じる。
  document.addEventListener("click", (event) => {
    const details = document.querySelector(".mockbar__more");
    if (!details || !details.open) return;
    if (details.contains(event.target)) return;
    details.open = false;
  });
})();
