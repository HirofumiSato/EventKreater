/*
 * モックの装飾切り替え。製品へは移さない。
 *
 *   導入（onboard）… tape-shadow  ホーム、新規作成、参加者、認証、公開ページ
 *   管理（admin）  … tape-quiet   主催者ホームと、そこに紐づく画面
 *
 *   ?t=tape-shadow | tape-quiet | base
 *
 *   既定は用途（data-scope）で決める。選んだ値は、その場かぎり。
 *   画面を移ると、その画面の用途の装飾に戻る。用途の取り違えを防ぐため。
 *   横並びで比べたいときは mock-compare.html が URL で指定する。
 *
 *   base は「現行」（attendance.css のまま）で、比較の基準にだけ使う。
 */
(function () {
  const ALL = ["tape-shadow", "tape-quiet", "base"];
  const params = new URLSearchParams(location.search);

  if (params.has("embed")) {
    document.documentElement.classList.add("is-embed");

    // 枠の中ではブラウザのスクロールバーを消す。Windows の縦 15px が入ると、
    // 390px の枠が 375px に痩せて、実機（iOS は重ね表示）と改行位置が変わる。
    if (window.innerWidth <= 480) {
      const style = document.createElement("style");
      style.textContent =
        "html{scrollbar-width:none}html::-webkit-scrollbar{width:0;height:0}";
      document.head.append(style);
    }
  }

  const scope = document.body.dataset.scope === "admin" ? "admin" : "onboard";
  const DEFAULT = scope === "admin" ? "tape-quiet" : "tape-shadow";

  function initialDeco() {
    const fromUrl = params.get("t");
    if (ALL.includes(fromUrl)) return fromUrl;
    const fallback = document.body.dataset.defaultDeco;
    if (ALL.includes(fallback)) return fallback;
    return DEFAULT;
  }

  function syncButtons(deco) {
    // 帯は mock-shell.js があとから差し込む。押されたときに引き直す。
    for (const button of document.querySelectorAll("[data-deco-btn]")) {
      button.setAttribute("aria-pressed", String(button.dataset.decoBtn === deco));
    }
  }

  function applyDeco(deco) {
    document.body.classList.remove(
      "deco",
      "deco--tape",
      "deco--tape-shadow",
      "deco--tape-quiet",
      "theme-base",
    );
    if (deco === "base") {
      document.body.classList.add("theme-base");
    } else {
      document.body.classList.add("deco", "deco--tape", `deco--${deco}`);
    }
    syncButtons(deco);
  }

  applyDeco(initialDeco());

  // 委譲で拾う。帯が後から挿し込まれても効く。
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-deco-btn]");
    if (!button) return;
    applyDeco(button.dataset.decoBtn);
  });

  // ヘッダーのメニュー。製品は Navbar.tsx が状態を持つ。
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest(".site-menu-toggle");
    if (!toggle) {
      return;
    }
    const header = toggle.closest(".site-header");
    const open = header.dataset.menuOpen !== "true";
    header.dataset.menuOpen = String(open);
    toggle.setAttribute("aria-expanded", String(open));
  });
})();
