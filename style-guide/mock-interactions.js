// モック専用の操作。製品は読み込まない（`withMockInteractions` が各モックに 1 行足すだけ）。
//
// なぜ要るか:
//   モックは製品の DOM を写した静止画で、script を落としてある。そのままでは
//   ボタンを押しても何も起きず、遷移リンクも API が無いので動かない。ここでは
//   製品の見た目のまま「押したらどうなるか」だけを再現する。**API は呼ばない。**
//
// 再現するもの:
//   1. ヘッダー … 会員メニューと（狭い画面の）ナビの開閉
//   2. カレンダー … 日付の選択と日別一覧の差し替え、予定のモーダル
//   3. 作成のステップ … 見出しの開閉と「次へ」「戻る」
//   4. 音声入力 … 録音 → 文字化 → 入力欄へ反映、を疑似タイマーで
//   5. 共通 … URL のコピー、コピー作成・プレビュー・ログアウトの遷移、API 依存のトースト
//   6. 一覧の絞り込み … 「絞り込む」のモーダルと、状態でのカードの出し分け
//   7. 出欠の層 … 告知ページの層を開き、割引の支払額を計算し、送信の返事を出す
//   8. ヘッダーの切り抜き … 編集画面からトリミングのダイアログを開き、倍率だけ変える
//   9. 名簿の表示列 … 「表示列」からチェックボックスのダイアログを開き、列を出し入れする
//  10. 名簿の 1 枚 … 行を押して開く 1 枚。集金の切り替えをその場で入れ替える
//  11. 料金プラン … 帯から加入モーダルを開き、初月0円の札と 2 か月目からの金額を出す
//  12. 公開の確認 … 「公開する」から確認の層を開き、公開後は「チケットを使いました」を出す
//
// 値や文言を作り直すのは、音声入力のサンプル、押したときにしか出ない
// 絞り込みモーダルの中身、申込の割引モーダルの中身、ヘッダーの切り抜きダイアログ、
// 名簿の表示列ダイアログ、名簿の 1 枚の集金日時、料金プランの加入モーダル、
// 公開の確認と公開後の「チケットを使いました」だけ。
// 他の表示は製品の DOM のまま動かす。
// 隠し DOM（`data-mock-hidden`）は `scripts/lib/mock-variants.mjs` が合成している。

(function () {
  "use strict";

  const SVG = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    busy: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };

  /** `class="icon"` の SVG。製品のアイコンと同じ骨格にしておく。 */
  function icon(name) {
    return (
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      SVG[name] +
      "</svg>"
    );
  }

  /** 押したことの返事。製品の `.toast` と同じ骨格で出す。 */
  function toast(message, tone) {
    document.querySelectorAll(".toast").forEach((node) => node.remove());
    const host = document.createElement("div");
    host.className = "toast";
    host.innerHTML =
      '<div class="alert alert--' +
      (tone === "error" ? "error" : "success") +
      '"><div class="summary" style="border:0;padding:0"><p></p>' +
      '<button type="button" class="btn btn--ghost btn--sm">閉じる</button></div></div>';
    host.querySelector("p").textContent = message;
    host.querySelector("button").addEventListener("click", () => host.remove());
    document.body.append(host);
    window.setTimeout(() => host.remove(), 6000);
  }

  // ---- 1. ヘッダー -------------------------------------------------------

  function wireHeader() {
    const header = document.querySelector(".site-header");
    if (!header) return;

    const userButton = header.querySelector(".site-user__button");
    const userMenu = header.querySelector(".site-user-menu");
    const navToggle = header.querySelector(".site-menu-toggle");

    const setUser = (open) => {
      if (userButton) userButton.setAttribute("aria-expanded", String(open));
      if (userMenu) userMenu.setAttribute("data-open", String(open));
    };
    const setNav = (open) => {
      header.setAttribute("data-menu-open", String(open));
      if (navToggle) navToggle.setAttribute("aria-expanded", String(open));
      if (!open) setUser(false);
    };

    if (userButton && userMenu) {
      userButton.addEventListener("click", (event) => {
        event.stopPropagation();
        setUser(userMenu.getAttribute("data-open") !== "true");
      });
    }
    if (navToggle) {
      navToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        setNav(header.getAttribute("data-menu-open") !== "true");
      });
    }

    document.addEventListener("click", (event) => {
      if (userMenu && !userMenu.contains(event.target) && event.target !== userButton) setUser(false);
      if (!header.contains(event.target)) setNav(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      setUser(false);
      setNav(false);
    });
  }

  // ---- 2. カレンダー -----------------------------------------------------

  /** 日付ごとのセクション。隠し DOM も同じ属性で並んでいる。 */
  function daySections() {
    return Array.from(document.querySelectorAll("[data-mock-cal-date]"));
  }

  function showDay(date) {
    const sections = daySections();
    const next = sections.find((section) => section.getAttribute("data-mock-cal-date") === date);
    if (!next) return false;
    for (const section of sections) {
      if (section === next) section.removeAttribute("data-mock-hidden");
      else section.setAttribute("data-mock-hidden", "true");
    }
    return true;
  }

  /**
   * 押した日のまとまりへ寄せる。今月ぶんをまとめて出す画面（主催カレンダー）は
   * 日別のセクションを持たないので、一覧の日付見出し（`#cal-day-<日付>`）を探す。
   */
  function scrollToDay(date) {
    const target = document.getElementById("cal-day-" + date);
    if (!target) return false;
    for (const day of document.querySelectorAll(".cal-month__day")) {
      day.classList.toggle("is-selected", day === target);
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  /** 今月ぶんをまとめて出す画面か。日付を押しても、一覧の中身は変わらない。 */
  function hasMonthList() {
    return document.querySelector(".cal-month") !== null;
  }

  function wireCalendar() {
    const cal = document.querySelector(".cal");
    if (!cal) return;

    const cells = Array.from(cal.querySelectorAll(".cal__day"));
    for (const cell of cells) {
      const button = cell.querySelector(".cal__select");
      if (!button) continue;
      button.addEventListener("click", () => {
        for (const other of cells) {
          const otherButton = other.querySelector(".cal__select");
          if (!otherButton) continue;
          otherButton.setAttribute("aria-pressed", String(other === cell));
          other.classList.toggle("is-selected", other === cell);
        }
        const date = cell.getAttribute("data-mock-date");
        if (!date) return;
        if (showDay(date)) return;
        if (scrollToDay(date)) return;
        // 今月ぶんをまとめて出す画面は、予定の無い日を押しても一覧は変わらない。
        if (hasMonthList()) return;
        toast("この日はモックに写していません。1 枚目に戻します。", "error");
      });
    }

    // 予定の帯。製品は詳細のモーダルを開くが、モックには飛び先の情報が無いので
    // 日付と題名だけを見せる。
    for (const strip of cal.querySelectorAll(".cal__event")) {
      strip.addEventListener("click", () => openEventDialog(strip));
    }

    for (const button of cal.querySelectorAll(".cal__nav button")) {
      button.addEventListener("click", () => {
        toast("モックはこの月だけを写しています。");
      });
    }
  }

  function openEventDialog(strip) {
    const cell = strip.closest(".cal__day");
    const label = cell?.querySelector(".cal__select")?.getAttribute("aria-label") || "";
    const title = (strip.textContent || "").trim();

    const modal = document.createElement("div");
    modal.className = "modal modal--open";
    modal.innerHTML =
      '<button type="button" class="modal__backdrop" aria-label="閉じる"></button>' +
      '<div class="dialog" role="dialog" aria-modal="true">' +
      '<p class="eyebrow"></p>' +
      '<h2 class="dialog__title"></h2>' +
      '<p class="help">モックでは、この予定の詳細画面を持っていません。</p>' +
      '<div class="dialog__actions">' +
      '<button type="button" class="btn btn--ghost btn--block">閉じる</button>' +
      "</div></div>";
    modal.querySelector(".eyebrow").textContent = label.replace(/、.*$/, "");
    modal.querySelector(".dialog__title").textContent = title || "予定";
    document.body.append(modal);
    document.body.classList.add("is-modal-open");

    const close = () => {
      modal.remove();
      document.body.classList.remove("is-modal-open");
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    modal.querySelector(".modal__backdrop").addEventListener("click", close);
    modal.querySelector(".dialog__actions button").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
  }

  // ---- 3. 作成のステップ -------------------------------------------------

  function wireSteps() {
    const items = Array.from(document.querySelectorAll(".event-step"));
    if (items.length === 0) return;

    const bodyOf = (item) => item.querySelector("[data-mock-step-body]");

    const setOpen = (item, open) => {
      const toggle = item.querySelector(".event-step__toggle");
      if (toggle) toggle.setAttribute("aria-expanded", String(open));
      item.classList.toggle("event-step--open", open);
      const body = bodyOf(item);
      if (body) {
        if (open) body.removeAttribute("data-mock-hidden");
        else body.setAttribute("data-mock-hidden", "true");
      }
    };

    const goTo = (index) => {
      const target = items[index];
      if (!target) return;
      items.forEach((item, position) => {
        if (position < index) item.classList.add("event-step--done");
        setOpen(item, item === target);
      });
      const toggle = target.querySelector(".event-step__toggle");
      if (toggle) {
        toggle.scrollIntoView({ block: "start", behavior: "smooth" });
        toggle.focus({ preventScroll: true });
      }
    };

    items.forEach((item, index) => {
      const toggle = item.querySelector(".event-step__toggle");
      if (toggle && !toggle.classList.contains("event-step__toggle--static")) {
        toggle.addEventListener("click", () => {
          const open = item.classList.contains("event-step--open");
          setOpen(item, !open);
        });
      }

      for (const button of item.querySelectorAll(".event-step__actions button")) {
        if (button.classList.contains("event-step__next")) {
          button.addEventListener("click", () => goTo(index + 1));
        } else {
          button.addEventListener("click", () => goTo(index - 1));
        }
      }
    });

    // 見出しの「未入力 / 入力済み」は製品が state を描き直す。開いたら入力済みに見せる。
    // 「次へ」は製品では入力がそろうまで `disabled`。モックには検証が無いので、
    // その欄に触れた時点で押せるようにする（押した結果だけを再現する）。
    const markDone = (item) => {
      const state = item.querySelector(".event-step__state");
      if (state) state.textContent = "入力済み";
      const next = item.querySelector(".event-step__next");
      if (next) next.disabled = false;
    };
    for (const item of items) {
      item.querySelectorAll("input, select, textarea").forEach((field) => {
        field.addEventListener("input", () => markDone(item));
        field.addEventListener("change", () => markDone(item));
      });
    }
  }

  // ---- 4. 音声入力 -------------------------------------------------------

  /** 疑似の文字起こしで入れる値。製品の例文に寄せた固定値。 */
  function sampleValue(id) {
    if (id === "event-title") return "秋の芋煮会";
    if (id === "event-organizer-name") return "佐藤 みのり";
    if (id.startsWith("schedule-date-")) return "2026-11-08";
    if (id.startsWith("schedule-start-")) return "11:00";
    if (id.startsWith("schedule-end-")) return "15:00";
    if (id.startsWith("plan-name-")) return "一般";
    if (id.startsWith("plan-amount-")) return "3000";
    if (id.startsWith("plan-note-")) return "1 ドリンク付";
    if (id === "event-venue-name") return "河川敷公園 第 2 広場";
    if (id === "event-postal-code") return "1540005";
    if (id === "event-prefecture") return "東京都";
    if (id === "event-city") return "世田谷区";
    if (id === "event-town") return "三宿";
    if (id === "event-address-line") return "1-2-3";
    if (id === "event-building") return "集会所 2F";
    if (id === "event-capacity") return "40";
    if (id === "event-capacity-custom") return "60";
    if (id === "rsvp-deadline") return "2026-10-31T23:59";
    if (id === "event-rain-policy") return "";
    return "";
  }

  /**
   * 郵便番号から入る住所。製品は API を呼ぶので、モックは見本の 1 件だけを持つ。
   * 郵便番号の見本（1540005）と同じ住所にして、音声で入れたときに 3 欄が埋まるようにする。
   */
  const MOCK_ADDRESSES = {
    "1540005": { prefecture: "東京都", city: "世田谷区", town: "三宿" },
  };

  const ADDRESS_FIELDS = ["event-prefecture", "event-city", "event-town"];

  /**
   * 郵便番号が入ったら住所 3 欄を埋め、埋めた欄は巡回から外す。
   * 製品の VoiceInputDock は補完のあとで次の欄を決めるので、都道府県を聞き直さない。
   *
   * 製品は住所を API で引くあいだ、質問を「住所を調べています」に替え、例と「いまの値」を
   * 隠したうえで録音・戻る・スキップを止める。モックは API を呼ばないので、待ちの見た目だけを
   * 400ms 作ってから同じ順で欄を埋める。呼び出し元はこの Promise を待って次の欄を決める。
   */
  async function fillAddressFromPostalCode(code) {
    const address = MOCK_ADDRESSES[code];
    const panel = voice.panel;
    if (!address || !panel) return;

    const prompt = panel.querySelector(".voice-panel__prompt");
    const hint = panel.querySelector(".voice-panel__hint");
    const current = panel.querySelector(".voice-panel__current");
    const talk = panel.querySelector("[data-voice-talk]");
    const prev = panel.querySelector("[data-voice-prev]");
    const skip = panel.querySelector("[data-voice-skip]");

    // 質問を 1 行に絞る（製品が `searching` の間に出さないものと同じ組み合わせ）。
    prompt.textContent = "住所を調べています";
    hint.hidden = true;
    current.hidden = true;
    // 待ちのあいだに別の欄へ移らせない。録音も始めさせない。
    talk.disabled = true;
    prev.disabled = true;
    skip.disabled = true;

    // 製品は API の往復を待つ。モックは待っていることが分かる長さだけ止める。
    await new Promise((resolve) => later(resolve, 400));

    // 待っているあいだに閉じられたら、消えたパネルと欄は触らない。
    if (!voice.active || !voice.panel) return;

    for (const id of ADDRESS_FIELDS) {
      const target = document.getElementById(id);
      if (!target) continue;
      target.value = address[id.replace("event-", "")];
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.classList.add("voice-filled");
      window.setTimeout(() => target.classList.remove("voice-filled"), 900);
    }
    voice.fields = voice.fields.filter((entry) => !ADDRESS_FIELDS.includes(entry.field.id));

    // 質問・例・「いまの値」は、このあとの pointAt / finishVoice が引き直す。
    // ボタンのうち pointAt が戻さないのは主ボタンとスキップなので、ここで戻す。
    // 自動遷移がオフのときは同じ欄をもう一度指すだけなので、戻さないと録音を始められない。
    // 例は finishVoice が中身だけ差し替える（hidden は戻さない）ため、ここで出しておく。
    talk.disabled = false;
    prev.disabled = voice.cursor === 0;
    skip.disabled = false;
    hint.hidden = false;
  }

  function labelOf(field) {
    const labels = field.labels;
    const text = labels && labels.length > 0 ? (labels[0].textContent || "").trim() : "";
    return text || field.getAttribute("aria-label") || field.placeholder || "この項目";
  }

  /**
   * 質問文に使う短い名前。製品の欄名（「郵便番号」など）に合わせる。
   * ラベルの全文（「郵便番号から住所を入れる」）をそのまま「〜は？」に繋ぐと読みにくい。
   */
  const SHORT_LABELS = { "event-postal-code": "郵便番号" };

  /** 音声で埋められる入力欄を、画面の順に集める。 */
  function voiceFields() {
    const form = document.querySelector("form.event-steps") || document.querySelector(".page--form form");
    if (!form) return [];

    const fields = [];
    for (const field of form.querySelectorAll("input, select, textarea")) {
      if (field.disabled || field.readOnly) continue;
      if (field.type === "hidden" || field.type === "file") continue;
      if (field.type === "checkbox" || field.type === "radio") continue;
      if (field.tagName === "SELECT" && field.id !== "event-rain-policy") continue;
      const value = sampleValue(field.id);
      if (!value) continue;
      fields.push({ field, label: SHORT_LABELS[field.id] ?? labelOf(field), value });
    }
    return fields;
  }

  /** 男女別の費用のチェックボックス。`voiceFields()` はチェックボックスを拾わないので別に探す。 */
  function genderCheckbox() {
    const form = document.querySelector("form.event-steps") || document.querySelector(".page--form form");
    if (!form) return null;
    for (const box of form.querySelectorAll('input[type="checkbox"]')) {
      const label = box.closest("label");
      const text = label ? label.textContent || "" : "";
      if (text.indexOf("男女別の費用") >= 0) return box;
    }
    return null;
  }

  /**
   * 費用の最初（プラン名）の直前に「男女別の費用を設定しますか」のターンを足す。
   *
   * 製品はプラン名を聞く直前に尋ねる。モックはチェックボックスを巡回に含めないので、
   * ここで 1 ターン補う。はいならチェックを入れ、女性用の金額を巡回へ足す（`answerGender`）。
   * すでに男女別の画面なら、製品と同じく尋ねない。
   */
  function withGenderTurn(fields) {
    const box = genderCheckbox();
    if (!box || box.checked || box.disabled) return fields;
    if (document.querySelector(".price-group")) return fields;

    const at = fields.findIndex((entry) => entry.field.id && entry.field.id.startsWith("plan-name-"));
    if (at < 0) return fields;

    // 分けたあとに足す女性用の金額は、最初の男性用の金額（プラン名の次）を使う。
    const maleAmount = fields.find((entry) => entry.field.id && entry.field.id.startsWith("plan-amount-"));
    if (!maleAmount) return fields;

    const label = box.closest("label") || box;
    fields.splice(at, 0, {
      // 強調するのはチェックボックスではなく、その札ごと（文字まで読めるようにする）。
      field: label,
      control: box,
      amount: maleAmount,
      kind: "gender",
      label: "男女別の費用",
      value: "はい",
      prompt: "男女別の費用を設定しますか",
      hint: "はい／いいえ",
      // チェックボックスは値を持たないので、「いまの値」は出さない。
      current: "",
    });
    return fields;
  }

  const voice = {
    active: false,
    listening: false,
    busy: false,
    cursor: -1,
    fields: [],
    autoAdvance: true,
    panel: null,
    scrim: null,
    timers: [],
  };

  function clearTimers() {
    for (const timer of voice.timers) window.clearTimeout(timer);
    voice.timers.length = 0;
  }

  function later(callback, ms) {
    const timer = window.setTimeout(callback, ms);
    voice.timers.push(timer);
    return timer;
  }

  function buildVoicePanel() {
    const scrim = document.createElement("div");
    scrim.className = "voice-scrim";
    scrim.hidden = true;

    const panel = document.createElement("section");
    // 位置は欄を測ってから決める。測れる前の 1 フレームは `is-placing` で隠す（製品と同じ）。
    panel.className = "voice-panel is-placing";
    panel.setAttribute("aria-label", "音声入力");
    panel.innerHTML =
      '<div class="voice-panel__head">' +
      '<p class="voice-panel__status" hidden>' +
      '<span class="voice-rec" aria-hidden="true"><span class="voice-rec__dot"></span>REC</span>' +
      '<span class="voice-panel__state"></span>' +
      "</p>" +
      // 質問と例は 1 行に並べる（製品の `.voice-panel__ask`）。聞き取りの行は持たない。
      '<div class="voice-panel__ask">' +
      '<p class="voice-panel__prompt" aria-live="polite"></p>' +
      '<p class="voice-panel__hint"></p>' +
      "</div>" +
      '<button type="button" class="voice-panel__close" aria-label="音声入力を終了" title="音声入力を終了">' +
      icon("close") +
      "</button></div>" +
      '<p class="voice-panel__current" hidden></p>' +
      '<p class="voice-panel__message" role="status" hidden></p>' +
      '<div class="voice-panel__actions">' +
      // 主ボタンを縦積みの入れ物で包み、録音中だけその下に止め方を出す（製品と同じ）。
      '<div class="voice-panel__talk-wrap">' +
      '<button type="button" class="voice-icon-btn voice-icon-btn--primary" data-voice-talk aria-label="話す" title="話す">' +
      '<span data-icon="mic">' +
      icon("mic") +
      "</span>" +
      '<span data-icon="stop" hidden>' +
      icon("stop") +
      "</span>" +
      '<span data-icon="busy" hidden>' +
      icon("busy") +
      "</span></button>" +
      '<p class="voice-panel__talk" hidden>話し終わったら<br>タップ</p>' +
      "</div>" +
      '<button type="button" class="voice-icon-btn" data-voice-prev aria-label="戻る" title="戻る">' +
      icon("left") +
      "</button>" +
      // 飛ばすボタンも主ボタンと同じく、下に名前を出す（丸い印だけでは意味が分からない）。
      '<div class="voice-panel__talk-wrap">' +
      '<button type="button" class="voice-icon-btn" data-voice-skip aria-label="スキップ" title="スキップ">' +
      icon("right") +
      "</button>" +
      '<p class="voice-panel__talk">スキップ</p>' +
      "</div></div>" +
      '<div class="voice-panel__options">' +
      '<label class="check voice-panel__optional"><input type="checkbox" data-voice-optional checked> 任意の項目も聞く</label>' +
      '<label class="check voice-panel__optional"><input type="checkbox" data-voice-auto checked> 自動遷移</label>' +
      "</div>";

    document.body.append(scrim, panel);
    return { scrim, panel };
  }

  function voiceFab() {
    return document.querySelector(".voice-fab");
  }

  function setFabActive(active) {
    const fab = voiceFab();
    if (!fab) return;
    fab.setAttribute("aria-pressed", String(active));
    fab.setAttribute("aria-label", active ? "音声入力を終了" : "音声入力を開始");
    fab.setAttribute("title", active ? "音声入力を終了" : "音声入力を開始");
    fab.classList.toggle("voice-fab--active", active);
    if (active) {
      fab.dataset.mockIdleIcon = fab.innerHTML;
      fab.innerHTML = icon("close");
    } else if (fab.dataset.mockIdleIcon) {
      fab.innerHTML = fab.dataset.mockIdleIcon;
      delete fab.dataset.mockIdleIcon;
    }
  }

  function setTalkIcon(state) {
    if (!voice.panel) return;
    for (const holder of voice.panel.querySelectorAll("[data-icon]")) {
      holder.hidden = holder.getAttribute("data-icon") !== state;
    }
    const talk = voice.panel.querySelector("[data-voice-talk]");
    if (talk) talk.dataset.state = state;
  }

  /**
   * パネルを強調中の欄のすぐ下へ置く。製品の `panelBoxFor` と同じ計算で、
   * 上端は欄の下端 + 8px、左端は欄の左、右端は右下の FAB の左 - 8px で止める。
   * モックは固定の CSS をそのまま使うため、3 つの変数を inline style で与えないと既定値の位置に出る。
   */
  function placePanel() {
    if (!voice.active || !voice.panel) return;
    const field = voice.fields[voice.cursor]?.field;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const gap = 8;
    const fab = voiceFab();
    const fabRect = fab ? fab.getBoundingClientRect() : null;
    const left = Math.max(0, rect.left);
    const right = Math.min(rect.right, fabRect ? fabRect.left - gap : rect.right);
    voice.panel.style.setProperty("--voice-panel-top", rect.bottom + gap + "px");
    voice.panel.style.setProperty("--voice-panel-left", left + "px");
    voice.panel.style.setProperty("--voice-panel-width", Math.max(0, right - left) + "px");
    voice.panel.classList.remove("is-placing");
  }

  /** 対象の欄を四角く残して、まわりを暗くする。 */
  function measureSpotlight() {
    placePanel();
    if (!voice.active || !voice.scrim) return;
    const field = voice.fields[voice.cursor]?.field;
    if (!field) {
      voice.scrim.hidden = true;
      return;
    }
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      voice.scrim.hidden = true;
      return;
    }
    const pad = 6;
    const top = Math.max(0, rect.top - pad);
    const left = Math.max(0, rect.left - pad);
    const right = Math.min(window.innerWidth, rect.right + pad);
    const bottom = Math.min(window.innerHeight, rect.bottom + pad);
    voice.scrim.hidden = false;
    voice.scrim.style.clipPath =
      "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, " +
      left +
      "px " +
      top +
      "px, " +
      right +
      "px " +
      top +
      "px, " +
      right +
      "px " +
      bottom +
      "px, " +
      left +
      "px " +
      bottom +
      "px, " +
      left +
      "px " +
      top +
      "px)";
  }

  /** 対象のステップを開き、欄を見えるところへ出して、プロンプトを差し替える。 */
  function pointAt(index) {
    if (!voice.panel) return;
    voice.listening = false;
    voice.busy = false;
    setTalkIcon("mic");

    if (index < 0) index = 0;
    if (index >= voice.fields.length) {
      finishVoice();
      return;
    }
    voice.cursor = index;
    const entry = voice.fields[index];

    // 対象の欄だけを枠で示す（製品と同じ `data-voice-target`）。
    for (const item of document.querySelectorAll("[data-voice-target]")) {
      item.removeAttribute("data-voice-target");
    }
    entry.field.setAttribute("data-voice-target", "true");

    const step = entry.field.closest(".event-step");
    if (step) {
      const toggle = step.querySelector(".event-step__toggle");
      for (const other of document.querySelectorAll(".event-step")) {
        const body = other.querySelector("[data-mock-step-body]");
        const open = other === step;
        other.classList.toggle("event-step--open", open);
        if (toggle) toggle.setAttribute("aria-expanded", String(open));
        if (body) {
          if (open) body.removeAttribute("data-mock-hidden");
          else body.setAttribute("data-mock-hidden", "true");
        }
      }
    }

    entry.field.scrollIntoView({ block: "center", behavior: "smooth" });
    placePanel();
    window.setTimeout(measureSpotlight, 320);

    voice.panel.querySelector(".voice-panel__prompt").textContent =
      entry.prompt || entry.label + "は？";
    const hint = voice.panel.querySelector(".voice-panel__hint");
    hint.textContent = "例: " + (entry.hint || entry.value);
    hint.hidden = false;
    // 入力済みの欄では、質問の下に「いまの値: …」を小さく出す（製品と同じ）。
    // チェックボックスのターンは値を持たないので `current` で空を渡す。
    const current = voice.panel.querySelector(".voice-panel__current");
    const value =
      entry.current !== undefined ? entry.current : (entry.field.value || "").trim();
    current.textContent = value ? "いまの値: " + value : "";
    current.hidden = !value;
    voice.panel.querySelector(".voice-panel__talk").hidden = true;
    voice.panel.querySelector(".voice-panel__status").hidden = true;
    voice.panel.querySelector(".voice-panel__message").hidden = true;
    voice.panel.querySelector("[data-voice-optional]").closest(".check").hidden = false;
    voice.panel.querySelector("[data-voice-auto]").closest(".check").hidden = false;
    voice.panel.querySelector("[data-voice-prev]").disabled = index === 0;
    // 住所検索の写しが止めたボタンも、欄を指し直した時点で元へ戻す。
    // （検索中に別の欄を押すと `clearTimers` で待ちが消え、戻す機会が無くなるため）
    voice.panel.querySelector("[data-voice-talk]").disabled = false;
    voice.panel.querySelector("[data-voice-skip]").disabled = false;
  }

  function startListening() {
    if (!voice.active || voice.busy) return;
    const status = voice.panel.querySelector(".voice-panel__status");
    status.hidden = false;
    voice.panel.querySelector(".voice-panel__state").textContent = "録音中";
    voice.panel.querySelector(".voice-panel__message").hidden = true;
    voice.panel.querySelector(".voice-panel__talk").hidden = false;
    voice.listening = true;
    setTalkIcon("stop");
    clearTimers();
    later(finishListening, 2600);
  }

  function finishListening() {
    if (!voice.listening) return;
    voice.listening = false;
    voice.busy = true;
    voice.panel.querySelector(".voice-panel__talk").hidden = true;
    setTalkIcon("busy");
    voice.panel.querySelector(".voice-panel__state").textContent = "テキスト変換中";
    later(applyListening, 700);
  }

  /**
   * 男女別の費用のターンに答える。
   *
   * モックは回答の UI を持たないので、製品で「はい」を選んだときと同じくチェックを入れ、
   * 女性用の金額を巡回へ足す。すでに男女別なら何もせず次へ進む（＝「いいえ」と同じ）。
   */
  function answerGender(entry) {
    const box = entry.control;
    if (!box || box.checked || box.disabled) return;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    const label = box.closest("label");
    if (label) {
      label.classList.add("voice-filled");
      window.setTimeout(() => label.classList.remove("voice-filled"), 900);
    }
    // モックの DOM は静的で女性用の行が増えないため、男性用の金額の直後に同じ金額の行を足す。
    const at = voice.fields.findIndex((item) => item.field === entry.amount.field);
    voice.fields.splice((at < 0 ? voice.cursor : at) + 1, 0, {
      field: entry.amount.field,
      label: "女性の金額",
      value: entry.amount.value,
    });
  }

  async function applyListening() {
    const entry = voice.fields[voice.cursor];
    if (!entry) {
      finishVoice();
      return;
    }

    if (entry.kind === "gender") {
      answerGender(entry);
    } else {
      const field = entry.field;
      field.value = entry.value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));

      field.classList.add("voice-filled");
      window.setTimeout(() => field.classList.remove("voice-filled"), 900);

      // 郵便番号から住所を引く。製品と同じで、埋まった欄は次の巡回から外れる。
      // 製品は検索を待ってから次の欄を決めるので、モックも検索の写しを待ってから進める。
      if (field.id === "event-postal-code") await fillAddressFromPostalCode(entry.value);
    }

    // 検索を待つあいだに閉じられたら、パネルはもう無い。描き直さずに終わる。
    if (!voice.active || !voice.panel) return;

    const status = voice.panel.querySelector(".voice-panel__status");
    if (status) status.hidden = true;
    voice.busy = false;
    setTalkIcon("mic");

    if (!voice.autoAdvance) {
      pointAt(voice.cursor);
      return;
    }
    if (voice.cursor + 1 >= voice.fields.length) {
      finishVoice();
      return;
    }
    pointAt(voice.cursor + 1);
    startListening();
  }

  function finishVoice() {
    clearTimers();
    voice.listening = false;
    voice.busy = false;
    for (const item of document.querySelectorAll("[data-voice-target]")) {
      item.removeAttribute("data-voice-target");
    }
    if (!voice.panel) return;
    voice.panel.querySelector(".voice-panel__prompt").textContent = "入力完了！";
    const hint = voice.panel.querySelector(".voice-panel__hint");
    hint.textContent = "内容を確かめて、そのまま公開できます。";
    voice.panel.querySelector(".voice-panel__status").hidden = true;
    voice.panel.querySelector(".voice-panel__message").hidden = true;
    voice.panel.querySelector(".voice-panel__talk").hidden = true;
    voice.panel.querySelector(".voice-panel__current").hidden = true;
    voice.panel.querySelector("[data-voice-optional]").closest(".check").hidden = true;
    voice.panel.querySelector("[data-voice-auto]").closest(".check").hidden = true;
    voice.panel.querySelector("[data-voice-talk]").disabled = true;
    if (voice.scrim) voice.scrim.hidden = true;
    later(closeVoice, 3000);
  }

  function startVoice() {
    if (voice.active) {
      closeVoice();
      return;
    }
    voice.fields = withGenderTurn(voiceFields());
    if (voice.fields.length === 0) {
      toast("この画面には音声で入れる欄がありません。");
      return;
    }
    voice.active = true;
    voice.autoAdvance = true;
    const built = buildVoicePanel();
    voice.panel = built.panel;
    voice.scrim = built.scrim;

    voice.panel.querySelector(".voice-panel__close").addEventListener("click", closeVoice);
    voice.scrim.addEventListener("click", () => {
      toast("入力中の欄を押すか、閉じるで終われます。");
    });
    voice.panel.querySelector("[data-voice-talk]").addEventListener("click", () => {
      if (voice.busy) return;
      if (voice.listening) finishListening();
      else startListening();
    });
    voice.panel.querySelector("[data-voice-prev]").addEventListener("click", () => {
      // 録音中でも戻れる。いまの録音は捨て、戻った欄で録音を始める（製品と同じ）。
      clearTimers();
      voice.listening = false;
      setTalkIcon("mic");
      pointAt(voice.cursor - 1);
      startListening();
    });
    voice.panel.querySelector("[data-voice-skip]").addEventListener("click", () => {
      clearTimers();
      const next = voice.cursor + 1;
      pointAt(next);
      // 製品と同じく、飛ばしたあとも次の欄の録音を続ける（止まって見えないように）。
      if (next < voice.fields.length) startListening();
    });
    voice.panel.querySelector("[data-voice-auto]").addEventListener("change", (event) => {
      voice.autoAdvance = event.target.checked;
    });
    voice.panel.querySelector("[data-voice-optional]").addEventListener("change", () => {
      // 任意の項目（空欄でよい欄）は今のモックでは区別しない。押せることが伝われば足りる。
      toast("任意の項目は、空欄のまま次へ進めます。");
    });

    // 入力欄を直接押したら、その欄に切り替える（製品と同じ）。
    for (const entry of voice.fields) {
      entry.field.addEventListener(
        "focus",
        () => {
          if (!voice.active) return;
          const index = voice.fields.findIndex((item) => item.field === entry.field);
          if (index >= 0 && index !== voice.cursor) {
            clearTimers();
            pointAt(index);
          }
        },
        { once: false },
      );
    }

    setFabActive(true);
    const start = voice.fields.findIndex((entry) => !entry.field.value);
    pointAt(start < 0 ? 0 : start);
    later(startListening, 400);
  }

  function closeVoice() {
    clearTimers();
    voice.active = false;
    voice.listening = false;
    voice.busy = false;
    voice.cursor = -1;
    for (const item of document.querySelectorAll("[data-voice-target]")) {
      item.removeAttribute("data-voice-target");
    }
    if (voice.panel) voice.panel.remove();
    if (voice.scrim) voice.scrim.remove();
    voice.panel = null;
    voice.scrim = null;
    setFabActive(false);
    const fab = voiceFab();
    if (fab) fab.disabled = false;
  }

  function wireVoice() {
    const fab = voiceFab();
    if (!fab) return;
    fab.addEventListener("click", startVoice);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && voice.active) closeVoice();
    });
    window.addEventListener("scroll", measureSpotlight, { passive: true });
    window.addEventListener("resize", measureSpotlight);
  }

  // ---- 5. 共通の操作 -----------------------------------------------------

  /**
   * API を呼ばないと進まないボタン。押したら「モックでは実行しません」と返す。
   *
   * プレビュー画面の「公開する」は、押したときに確認の層を挟むのでここには入れない
   * （`wirePublishConfirm` が開き、層の中の「公開する」だけがこの返事を使う）。
   */
  const API_ACTIONS = new Set([
    "ログインして公開/下書き保存",
    "下書き保存",
    "保存する",
    "更新する",
    "公開を一時停止",
    "公開を再開",
    "公開一時停止",
    "公開再開",
    "削除する",
    "招待する",
    "解除する",
    "再発行",
    "受け取る",
    "支払う",
    "解約する",
    "退会する",
    "送信する",
    "申し込む",
    "取り消す",
    "LINEで共有",
  ]);

  const NAVIGATES = new Map([
    ["コピー作成", "mock-create.html"],
    ["プレビューを見る", "mock-preview.html"],
    ["ログアウト", "mock-home.html"],
  ]);

  /** この JS が動かしている操作。押してもトーストを出さない。 */
  const WIRED =
    ".site-header, .cal, .event-step__toggle, .event-step__next, .voice-fab, .list-filters, " +
    ".rsvp-entry, .rsvp-summary__actions, .sticky-rsvp, .modal--sheet, [data-mock-wired]";

  function normalized(text) {
    return (text || "").replace(/\s+/g, "").trim();
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      return;
    }
    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.append(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch {
      // クリップボードが使えない環境では何もしない。
    }
    area.remove();
  }

  function wireActions() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target.closest("button, a");
        if (!target) return;
        // モーダル・トースト・音声パネルの中は、それぞれの処理に任せる。
        if (target.closest(".modal, .toast, .voice-panel, .voice-scrim")) return;

        const label = normalized(target.textContent);

        // 一覧の札の URL コピー。文字を持たない操作は読み上げ名で見分ける。
        // 文字のボタン（「URLをコピー」と、押したあとの「コピーしました」）も同じ経路に
        // 乗せる。同じ操作が文言の有無で別の分岐へ落ちると、モックの返事が食い違うため。
        const spoken = normalized(target.getAttribute("aria-label") || "");
        const copiesCardUrl =
          (label === "" && spoken.includes("コピー")) ||
          label === "URLをコピー" ||
          label === "コピーしました";
        if (copiesCardUrl) {
          // コピー先は同じ札の「公開ページ」を先に読む。チラシ画像の無い札では
          // サムネイルのリンクが無いので、画像の有無でコピーの行き先が消えないようにする。
          // 「公開ページ」が無ければ従来どおりチラシのリンクを使う。
          const card = target.closest(".event-card");
          const link = card
            ? card.querySelector(".event-card__public-link") ||
              card.querySelector(".event-card__thumb-link")
            : null;
          if (link) {
            copyText(new URL(link.getAttribute("href"), location.href).href);
            toast("URL をコピーしました。");
            return;
          }
          if (label !== "URLをコピー") {
            toast("コピーする URL がありません。", "error");
            return;
          }
          // 札の外の「URLをコピー」は、下の分岐で近くの入力欄からコピーする。
        }

        if (label === "URLをコピー") {
          const row = target.closest(".input-row") || target.parentElement;
          const input = row ? row.querySelector("input, textarea") : null;
          const url = input ? input.value : "";
          if (url) {
            copyText(url);
            toast("URL をコピーしました。");
          } else {
            toast("コピーする URL がありません。", "error");
          }
          return;
        }

        const href = NAVIGATES.get(label);
        if (href) {
          event.preventDefault();
          window.location.href = href;
          return;
        }

        if (API_ACTIONS.has(label)) {
          event.preventDefault();
          toast("モックでは実行しません（API が要ります）。");
          return;
        }

        // 「〜をコピー」は、近くの入力欄があればその値をクリップボードへ入れる。
        if (/コピー$/.test(label)) {
          const scope = target.closest(".input-row, form, section, .panel") || document;
          const input = scope.querySelector('input:not([type="hidden"]), textarea');
          if (input && input.value) {
            copyText(input.value);
            toast("コピーしました。");
          } else {
            toast("モックにはコピーする文面がありません。", "error");
          }
          return;
        }

        // どの分岐にも当たらなかった操作は、API が要るものとして返事だけ返す。
        // 遷移先のあるリンクと、この JS が動かしている操作はそのままにする。
        if (target.closest(WIRED) || label === "戻る" || label === "次へ") return;
        if (target.tagName === "A") {
          const hrefValue = target.getAttribute("href");
          if (hrefValue && hrefValue !== "#") return;
        }
        event.preventDefault();
        if (target.disabled) return;
        toast("モックでは実行しません（API が要ります）。");
      },
      true,
    );
  }

  // ---- 6. 一覧の絞り込み -------------------------------------------------

  /** 状態の値 → カードの札の文言。`ALL` は札を見ない。 */
  const LIST_STATUS_BADGE = { PUBLISHED: "公開中", CLOSED: "受付停止" };

  /** 並び順のアイコン。製品の DOM（lucide の SVG）から写したもの。 */
  const SORT_ICONS = {
    desc:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      ' class="lucide lucide-arrow-down-narrow-wide icon" aria-hidden="true">' +
      '<path d="m3 16 4 4 4-4"></path><path d="M7 20V4"></path><path d="M11 4h4"></path>' +
      '<path d="M11 8h7"></path><path d="M11 12h10"></path></svg>',
    asc:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      ' class="lucide lucide-arrow-up-narrow-wide icon" aria-hidden="true">' +
      '<path d="m3 8 4-4 4 4"></path><path d="M7 4v16"></path><path d="M11 12h4"></path>' +
      '<path d="M11 16h7"></path><path d="M11 20h10"></path></svg>',
  };

  /** カードの見出しに並ぶ 1 つ目の札（状態）。2 つ目は主催・共同主催。 */
  function statusBadgeText(card) {
    const badge = card.querySelector(".event-card__head .badge");
    return badge ? (badge.textContent || "").trim() : "";
  }

  /**
   * 主催一覧の「絞り込む」。640px 未満では状態と開催日をモーダルへ畳む（製品は state で出す）。
   *
   * モックでは、隠れているインラインの入力を写してモーダルを組み、状態でカードを
   * 出し分ける。開催日はカードの札（「11月26日（木）」）から年を読み取れないので、
   * 条件は受けるが一覧は動かさない。
   */
  function wireListFilters() {
    const bar = document.querySelector(".list-filters");
    const openButton = bar ? bar.querySelector(".list-filters__open") : null;
    if (!bar || !openButton) return;

    const rows = Array.from(bar.querySelectorAll(".list-filters__field"))
      .map((field) => ({
        label: (field.querySelector(".list-filters__label")?.textContent || "").trim(),
        control: field.querySelector("select, input"),
      }))
      .filter((row) => row.control);
    if (rows.length === 0) return;

    const grid = document.querySelector(".event-card-grid");
    const cards = Array.from(document.querySelectorAll(".event-card-grid .event-card"));
    const statusRow = rows.find((row) => row.control.tagName === "SELECT");

    // 開催日の昇順降順。製品は `sortDate` で並べ替えるが、モックの札には年が無い。
    // 撮った一覧は 1 年ぶんだけなので、月日（M月D日）だけで並べ替える。
    const sortButton = bar.querySelector(".list-filters__sort");
    if (sortButton && grid) {
      const dateOf = (card) => {
        const label = card.querySelector(".event-card__meta")?.textContent || "";
        const found = /(\d+)月(\d+)日/.exec(label);
        return found ? Number(found[1]) * 100 + Number(found[2]) : 0;
      };
      let order = "desc";
      sortButton.addEventListener("click", () => {
        order = order === "asc" ? "desc" : "asc";
        const direction = order === "asc" ? 1 : -1;
        const sorted = [...cards].sort((left, right) => {
          const a = dateOf(left);
          const b = dateOf(right);
          if (a === b) return 0;
          return a < b ? -direction : direction;
        });
        for (const card of sorted) grid.append(card);
        const label = order === "asc" ? "開催日の新しい順に並べ替える" : "開催日の古い順に並べ替える";
        sortButton.setAttribute("aria-label", label);
        sortButton.title = label;
        sortButton.innerHTML = SORT_ICONS[order];
      });
    }

    const filled = (row) => Boolean(row.control.value) && row.control.value !== "ALL";

    /** ボタンの件数は、外に出している「過去の催しを除く」を数えない。 */
    const syncButton = () => {
      const count = rows.filter(filled).length;
      openButton.textContent = count > 0 ? "絞り込む（" + count + "）" : "絞り込む";
    };

    // 該当が 0 件のときの 1 枚。製品と同じ骨格で、押せば条件を戻せるようにする。
    let emptyBlock = null;
    if (grid) {
      emptyBlock = document.createElement("div");
      emptyBlock.className = "empty";
      emptyBlock.setAttribute("data-mock-hidden", "true");
      emptyBlock.innerHTML =
        '<p class="empty__title">条件に合う催しはありません。</p>' +
        '<p class="empty__body">状態や開催日の範囲を広げると見つかります。 ' +
        '<button type="button" class="text-link">条件を戻す</button></p>';
      emptyBlock.querySelector("button").addEventListener("click", () => {
        for (const row of rows) row.control.value = row.control.tagName === "SELECT" ? "ALL" : "";
        applyListFilter();
      });
      grid.after(emptyBlock);
    }

    /** 確定した条件でカードを出し分ける。ページ割りは写した 1 ページのまま。 */
    function applyListFilter() {
      const want = statusRow ? LIST_STATUS_BADGE[statusRow.control.value] || "" : "";
      let shown = 0;
      for (const card of cards) {
        const visible = !want || statusBadgeText(card) === want;
        if (visible) {
          card.removeAttribute("data-mock-hidden");
          shown += 1;
        } else {
          card.setAttribute("data-mock-hidden", "true");
        }
      }
      syncButton();
      // ページ割りの件数は、写した時点のまま。0 件のときだけ出さない。
      for (const pager of document.querySelectorAll(".pager")) {
        if (shown === 0) pager.setAttribute("data-mock-hidden", "true");
        else pager.removeAttribute("data-mock-hidden");
      }
      if (emptyBlock) {
        if (shown === 0 && cards.length > 0) emptyBlock.removeAttribute("data-mock-hidden");
        else emptyBlock.setAttribute("data-mock-hidden", "true");
      }
    }

    let modal = null;
    let modalControls = [];

    const closeDialog = () => {
      if (!modal) return;
      modal.remove();
      openButton.setAttribute("aria-expanded", "false");
      document.body.classList.remove("is-modal-open");
    };

    const buildDialog = () => {
      const host = document.createElement("div");
      host.className = "modal modal--open";
      host.innerHTML =
        '<button type="button" class="modal__backdrop" aria-label="絞り込みを閉じる"></button>' +
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mock-filter-title">' +
        '<h3 id="mock-filter-title" class="dialog__title">絞り込む</h3>' +
        '<div class="dialog__content">' +
        '<div class="filter-dialog"></div>' +
        "</div>" +
        '<div class="dialog__actions">' +
        '<button type="button" class="btn btn--primary btn--block" data-mock-apply>この条件で絞り込む</button>' +
        '<button type="button" class="btn btn--ghost btn--block" data-mock-reset>条件を戻す</button>' +
        "</div></div>";

      const body = host.querySelector(".filter-dialog");
      modalControls = rows.map((row, index) => {
        // インラインの入力は 640px 未満で隠れる（`.list-filters__field`）。
        // 中身だけを写し、`.field` の枠に組み直す。
        const id = "mock-filter-" + index;
        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("label");
        label.className = "label";
        label.setAttribute("for", id);
        label.textContent = row.label;
        const control = row.control.cloneNode(true);
        control.id = id;
        control.value = row.control.value;
        field.append(label, control);
        body.append(field);
        return control;
      });
      body.insertAdjacentHTML(
        "beforeend",
        '<p class="help">開催日が範囲に入る催しだけを出します。' +
          "「過去の催しを除く」は一覧の上で切り替えます。</p>",
      );

      host.querySelector("[data-mock-apply]").addEventListener("click", () => {
        rows.forEach((row, index) => {
          row.control.value = modalControls[index].value;
          row.control.dispatchEvent(new Event("change", { bubbles: true }));
        });
        closeDialog();
        applyListFilter();
        if (rows.some((row) => row.control.tagName !== "SELECT" && row.control.value)) {
          toast("モックは撮った時点の一覧なので、開催日の絞り込みは再現しません。");
        }
      });
      host.querySelector("[data-mock-reset]").addEventListener("click", () => {
        for (const control of modalControls) {
          control.value = control.tagName === "SELECT" ? "ALL" : "";
        }
      });
      host.querySelector(".modal__backdrop").addEventListener("click", closeDialog);
      return host;
    };

    openButton.addEventListener("click", () => {
      if (modal && modal.isConnected) return;
      if (!modal) modal = buildDialog();
      // 開くたびに、確定している値をモーダルへ写し直す。
      modalControls.forEach((control, index) => {
        control.value = rows[index].control.value;
      });
      document.body.append(modal);
      document.body.classList.add("is-modal-open");
      openButton.setAttribute("aria-expanded", "true");
    });
  }

  // ---- 7. 申込の割引 -----------------------------------------------------

  /**
   * 告知ページの出欠。製品は層（`.modal--sheet`）を閉じたまま DOM に置き、
   * `hidden` を外して開く。撮った HTML にも同じ形で残るので、中身は組み直さず、
   * 隠す印を外すだけで開ける（押したときにしか出ない画面を作り直さずに済む）。
   *
   * 動かすのは 3 つだけ。開閉、割引を選び直したときの見出しの件数札、送信の返事。
   * 料金の計算は製品の要約（RsvpSummary）と名簿が持つので、モックでは持たない
   * （`discount-picker__summary` は製品から削除済み）。
   */
  function wireRsvpSheet() {
    const sheet = document.querySelector(".modal--sheet");
    if (!sheet) return;
    const form = sheet.querySelector("form");

    const setOpen = (open) => {
      if (open) {
        sheet.removeAttribute("hidden");
        sheet.classList.add("modal--open");
        document.documentElement.setAttribute("data-scroll-lock", "true");
      } else {
        sheet.setAttribute("hidden", "");
        sheet.classList.remove("modal--open");
        document.documentElement.removeAttribute("data-scroll-lock");
      }
    };

    // 入口は 3 つ。面のボタン、回答済みの「変更する」、画面下の帯。
    for (const trigger of document.querySelectorAll(
      ".rsvp-entry .btn, .rsvp-summary__actions .btn, .sticky-rsvp .btn--primary",
    )) {
      if (trigger.disabled) continue;
      trigger.addEventListener("click", () => setOpen(true));
    }

    const close = () => setOpen(false);
    const closeButton = sheet.querySelector(".dialog__close");
    if (closeButton) closeButton.addEventListener("click", close);
    const backdrop = sheet.querySelector(".modal__backdrop");
    if (backdrop) backdrop.addEventListener("click", close);
    for (const button of sheet.querySelectorAll(".dialog__actions .btn--ghost")) {
      button.addEventListener("click", close);
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !sheet.hasAttribute("hidden")) close();
    });

    if (form) {
      // 送信は API が要る。層は開いたまま、返事だけ返す。
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        toast("モックでは送信しません（API が要ります）。");
      });
    }

    // 出欠と性別を選び直したときの、入力できる欄の切り替え。
    //
    // 製品（`src/modules/attendance/lib/rsvp-form.ts`）は React が同じ規則で描く。
    // 撮った HTML は「出席・性別未選択」の状態なので、押したときにだけ同じ計算を
    // やり直す。欄は消さず、`field--disabled` と `disabled` を付け替えるだけ。
    if (form) {
      const fieldOf = (name) => form.querySelector(`input[name="${name}"]`)?.closest("fieldset") ?? null;
      const radiosOf = (name) => Array.from(form.querySelectorAll(`input[name="${name}"]`));
      const attending = () => {
        const checked = form.querySelector('input[name="rsvp"]:checked');
        return !checked || checked.value === "ATTENDING";
      };
      const gender = () => form.querySelector('input[name="gender"]:checked')?.value || "";

      // 出席なのに日時が 0 件なら、製品は送信を受け付けない（`disabled`）。
      // 撮った時点では日時が選ばれているので、外したときだけ同じ規則を再現する。
      const submitButton = sheet.querySelector('button[form="rsvp-form"]');
      const syncSubmit = () => {
        if (!submitButton) return;
        const none = !radiosOf("schedule").some((input) => input.checked);
        submitButton.disabled = attending() && none;
      };

      const paint = () => {
        const canInput = attending();
        for (const name of ["gender", "schedule", "price-plan"]) {
          const field = fieldOf(name);
          if (field) field.classList.toggle("field--disabled", !canInput);
        }
        for (const input of radiosOf("gender")) input.disabled = !canInput;
        for (const input of radiosOf("schedule")) input.disabled = !canInput;
        // 人数も欠席のときは押せない。欄は消さず、見出しだけ落とす。
        const partySize = form.querySelector("#rsvp-party-size");
        if (partySize) {
          partySize.disabled = !canInput;
          partySize.closest("fieldset")?.classList.toggle("field--disabled", !canInput);
        }
        for (const input of radiosOf("price-plan")) {
          const audience = input.getAttribute("data-audience") || "ANY";
          input.disabled = !canInput || (audience !== "ANY" && audience !== gender());
        }
        // 選んでいた札が押せなくなったら、先頭の押せる札へ移す（製品と同じ）。
        const plans = radiosOf("price-plan");
        const selected = plans.find((input) => input.checked);
        if (!selected || selected.disabled) {
          const first = plans.find((input) => !input.disabled) ?? null;
          for (const input of plans) input.checked = input === first;
        }
        for (const box of sheet.querySelectorAll(".discount-picker input")) box.disabled = !canInput;
        const extras = sheet.querySelector(".discount-picker")?.closest("details");
        if (extras) extras.classList.toggle("rsvp-extras--disabled", !canInput);
        syncSubmit();
      };

      for (const radio of [...radiosOf("rsvp"), ...radiosOf("gender")]) {
        radio.addEventListener("change", paint);
      }
      // 日時を外したとき・選び直したときも、送信できるかを見直す。
      for (const box of radiosOf("schedule")) box.addEventListener("change", syncSubmit);
      paint();
    }

    // 割引を選び直したときの、見出しの件数札だけを合わせる。
    //
    // モックは押したときの見た目を再現する。料金の計算は製品の要約（RsvpSummary）と
    // 名簿が持つので、ここでは扱わない。矢印と見出しの文字は触らず、札だけを作り直す。
    const syncExtrasCount = () => {
      const picker = sheet.querySelector(".discount-picker");
      const extrasLabel = picker?.closest("details")?.querySelector(".rsvp-extras__label");
      if (!extrasLabel) return;
      const count = Array.from(picker.querySelectorAll("input")).filter((input) => input.checked)
        .length;
      let badge = extrasLabel.querySelector(".rsvp-extras__count");
      if (count === 0) {
        badge?.remove();
      } else {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "rsvp-extras__count";
          extrasLabel.append(badge);
        }
        badge.textContent = count + "件";
      }
    };

    // 撮った時点の数字は製品のまま。選び直したときだけ札を数え直す。
    for (const box of sheet.querySelectorAll(".discount-picker input")) {
      box.addEventListener("change", syncExtrasCount);
    }
  }


  // ---- 8. ヘッダー画像の切り抜き -----------------------------------------

  /**
   * 編集画面のヘッダー欄から、トリミングのダイアログを開く。
   *
   * **このダイアログだけ骨格を組み直す**のは、製品ではファイルを選んだあとにしか
   * 出ないため、撮った HTML に残らないから（他の画面は製品の DOM をそのまま動かす）。
   * クラス名と並びは製品の `ImageCropDialog` に合わせ、3:1 の枠・拡大スライダー・
   * 決定/やめるを同じ見た目で置く。画像は欄の見本が持つデモ画像を写し、
   * 決定では API を呼ばずに閉じて、製品と同じ文言のトーストを出すだけにする。
   * 位置のドラッグは写さない（倍率だけ変えられれば、枠の見え方は確かめられる）。
   */
  function wireHeaderCrop() {
    const field = document.querySelector(".header-field");
    const openButton = field?.querySelector(".header-field__body .btn-row .btn--outline");
    if (!field || !openButton) return;

    // 見本の画像をそのまま使う。撮った HTML では `assets/` の実ファイルを指している。
    const imageSrc = field.querySelector(".header-field__preview img")?.getAttribute("src") || "";

    let modal = null;

    const close = () => {
      if (!modal) return;
      modal.remove();
      modal = null;
      openButton.setAttribute("aria-expanded", "false");
      document.documentElement.removeAttribute("data-scroll-lock");
    };

    const buildDialog = () => {
      const host = document.createElement("div");
      host.className = "modal modal--open";
      host.innerHTML =
        '<button type="button" class="modal__backdrop" aria-label="切り抜きをやめる"></button>' +
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mock-header-crop-title">' +
        '<button type="button" class="dialog__close" aria-label="切り抜きをやめる">' +
        icon("close") +
        "</button>" +
        '<h3 id="mock-header-crop-title" class="dialog__title">ヘッダー画像を切り抜く</h3>' +
        '<div class="dialog__content">' +
        '<div class="header-crop">' +
        '<div class="header-crop__frame" role="group" aria-label="切り抜く位置">' +
        (imageSrc
          ? '<img class="header-crop__canvas" src="' +
            imageSrc +
            '" alt="" width="1920" height="640" decoding="async">'
          : "") +
        '<span class="header-crop__status">画像を読み込んでいます…</span>' +
        "</div>" +
        '<div class="header-crop__zoom">' +
        '<label class="label" for="mock-header-crop-zoom">拡大</label>' +
        '<input id="mock-header-crop-zoom" class="header-crop__range" type="range" min="1" max="3" step="0.1" value="1" aria-valuetext="1.0倍">' +
        '<output class="header-crop__value" for="mock-header-crop-zoom">1.0倍</output>' +
        "</div>" +
        '<p class="dialog__body header-crop__help">ドラッグか矢印キーで位置を決めます。</p>' +
        '<p class="dialog__note">幅800px未満になる範囲は選べません。</p>' +
        "</div>" +
        "</div>" +
        '<div class="dialog__actions">' +
        '<button type="button" class="btn btn--primary btn--block" data-mock-crop-ok>この範囲で決定</button>' +
        '<button type="button" class="btn btn--ghost btn--block" data-mock-crop-cancel>やめる</button>' +
        "</div></div>";

      const image = host.querySelector(".header-crop__canvas");
      const status = host.querySelector(".header-crop__status");
      if (image) {
        // 読み込み終わるまでは、製品と同じ「読み込んでいます」を出す。
        const hideStatus = () => status?.remove();
        image.addEventListener("load", hideStatus);
        image.addEventListener("error", () => {
          if (status) status.textContent = "この画像は開けませんでした。";
        });
        if (image.complete) hideStatus();
      } else if (status) {
        status.textContent = "ヘッダー画像がまだありません。";
      }

      // 拡大だけを写す。製品は canvas を描き直すが、モックは 1 枚の画像を
      // 枠の中心で拡大すれば同じ見え方になる（枠は overflow: hidden）。
      const range = host.querySelector(".header-crop__range");
      const value = host.querySelector(".header-crop__value");
      range.addEventListener("input", () => {
        const zoom = Number(range.value);
        const text = zoom.toFixed(1) + "倍";
        if (value) value.textContent = text;
        range.setAttribute("aria-valuetext", text);
        if (image) image.style.transform = "scale(" + zoom + ")";
      });

      host.querySelector("[data-mock-crop-ok]").addEventListener("click", () => {
        // 製品はここで POST する。モックは送れないので、閉じて同じ文言を返す。
        close();
        toast("ヘッダー画像を変更しました。");
      });
      host.querySelector("[data-mock-crop-cancel]").addEventListener("click", close);
      host.querySelector(".dialog__close").addEventListener("click", close);
      host.querySelector(".modal__backdrop").addEventListener("click", close);

      return host;
    };

    openButton.addEventListener("click", () => {
      if (modal && modal.isConnected) return;
      modal = buildDialog();
      document.body.append(modal);
      document.documentElement.setAttribute("data-scroll-lock", "true");
      openButton.setAttribute("aria-expanded", "true");
    });

    // 製品の `Dialog` は Escape でも閉じる。開いている間だけ拾う。
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal) close();
    });
  }

  // ---- 9. 参加者名簿の表示列 ---------------------------------------------

  /**
   * 名簿の「表示列」から、列のチェックボックスを開く。
   *
   * **このダイアログだけ骨格を組み直す**のは、製品では押したときにしか出ず、
   * 撮った HTML に残らないため（8 のヘッダー切り抜きと同じ扱い）。
   * 並び・ラベル・初期値は撮った `th[data-column]` から読み、製品の列の定義は写さない。
   * チェックを変えたら `th` / `td` の `hidden` を付け替えるだけで、製品と同じ計算になる。
   * 名前の列は、製品と同じく disabled にして外せなくする。
   */
  function wireRosterColumns() {
    const table = document.querySelector("table.roster");
    if (!table) return;
    const head = table.closest(".table-card")?.querySelector(".table-card__head");
    const openButton = Array.from(head?.querySelectorAll("button") ?? []).find(
      (button) => (button.textContent || "").trim() === "表示列",
    );
    if (!openButton) return;

    // 外せない列。名前が無いと誰の行か分からなくなる（製品と同じ）。
    const LOCKED = ["name"];
    const columns = Array.from(table.querySelectorAll("thead th[data-column]")).map((th) => ({
      key: th.getAttribute("data-column"),
      label: (th.textContent || "").trim(),
      th,
      locked: LOCKED.includes(th.getAttribute("data-column")),
    }));
    if (columns.length === 0) return;

    // 該当なしの行の colspan も、製品と同じく出している列の数へ合わせる。
    const emptyCells = Array.from(table.querySelectorAll("tbody td[colspan]"));

    /** 押したことのある操作として印を付ける（wireActions のトーストを出さない）。 */
    openButton.setAttribute("data-mock-wired", "true");
    openButton.setAttribute("aria-haspopup", "dialog");
    openButton.setAttribute("aria-expanded", "false");

    let modal = null;
    /** 列のキー → ダイアログのチェックボックス。 */
    let boxes = new Map();

    const syncTable = () => {
      let shown = 0;
      for (const column of columns) {
        const show = column.locked || Boolean(boxes.get(column.key)?.checked);
        if (show) shown += 1;
        for (const cell of table.querySelectorAll('[data-column="' + column.key + '"]')) {
          cell.hidden = !show;
        }
      }
      for (const cell of emptyCells) cell.colSpan = shown;
    };

    const close = () => {
      if (!modal) return;
      modal.remove();
      modal = null;
      openButton.setAttribute("aria-expanded", "false");
      document.documentElement.removeAttribute("data-scroll-lock");
    };

    const buildDialog = () => {
      const host = document.createElement("div");
      host.className = "modal modal--open";
      host.innerHTML =
        '<button type="button" class="modal__backdrop" aria-label="閉じる"></button>' +
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mock-roster-columns-title" tabindex="-1">' +
        '<button type="button" class="dialog__close" aria-label="閉じる">' +
        icon("close") +
        "</button>" +
        '<h3 id="mock-roster-columns-title" class="dialog__title">表示する列</h3>' +
        '<div class="dialog__content">' +
        '<p class="dialog__body">よく見る列だけを残すと、スマホでも横に送らずに読めます。</p>' +
        '<div class="column-picker"></div>' +
        "</div>" +
        '<div class="dialog__actions">' +
        '<button type="button" class="btn btn--sm" data-mock-columns-close>閉じる</button>' +
        "</div></div>";

      const picker = host.querySelector(".column-picker");
      boxes = new Map();
      for (const column of columns) {
        const label = document.createElement("label");
        label.className = "check";
        const input = document.createElement("input");
        input.type = "checkbox";
        // 開くたびに、いま隠している列をそのまま初期値にする。
        input.checked = column.locked || !column.th.hidden;
        input.disabled = column.locked;
        input.addEventListener("change", syncTable);
        const text = document.createElement("span");
        text.textContent = column.label;
        label.append(input, text);
        picker.append(label);
        boxes.set(column.key, input);
      }

      for (const button of host.querySelectorAll(
        ".dialog__close, .modal__backdrop, [data-mock-columns-close]",
      )) {
        button.addEventListener("click", close);
      }
      return host;
    };

    openButton.addEventListener("click", () => {
      if (modal && modal.isConnected) return;
      modal = buildDialog();
      document.body.append(modal);
      document.documentElement.setAttribute("data-scroll-lock", "true");
      openButton.setAttribute("aria-expanded", "true");
    });

    // 製品の `Dialog` は Escape でも閉じる。開いている間だけ拾う。
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal) close();
    });
  }


  // ---- 10. 参加者名簿の 1 枚 ---------------------------------------------

  /**
   * 名簿の行を押したときに開く 1 枚（製品の `ParticipantSheet`）。
   *
   * 製品では押したときにしか出ず、撮った HTML に残らないので、ここで骨格を組み直す。
   * 値は押した行のセルから読む（名前・出欠・人数・費用プラン・コメント）。
   * 日時は撮った HTML に無い（既定の表示列に無い）ので、この写しでは出さない。
   * 出欠を「出席」以外にすると、席を取らない項目を隠す（製品と同じ）。
   */
  function wireRosterRowSheet() {
    const table = document.querySelector("table.roster");
    if (!table) return;
    const rows = Array.from(table.querySelectorAll("tbody tr")).filter((row) =>
      row.querySelector(".roster__open"),
    );
    if (rows.length === 0) return;

    let modal = null;

    const cellText = (row, key) => {
      const cell = row.querySelector('td[data-column="' + key + '"]');
      return cell ? (cell.textContent || "").trim() : "";
    };

    /** 費用プランは、割引と支払額の行を除いた「プラン名 金額」だけを取る。 */
    const planText = (row) => {
      const cell = row.querySelector('td[data-column="pricePlan"]');
      if (!cell) return "";
      const first = Array.from(cell.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim(),
      );
      return (first?.textContent || "").trim() || cellText(row, "pricePlan");
    };

    const close = () => {
      if (!modal) return;
      modal.remove();
      modal = null;
      document.documentElement.removeAttribute("data-scroll-lock");
    };

    const build = (row) => {
      const name = cellText(row, "name").replace(/待ち \d+番目/, "").trim();
      const status = cellText(row, "status");
      const gender = cellText(row, "gender");
      const partySize = cellText(row, "partySize").replace(/[^\d]/g, "") || "1";
      const plan = planText(row);
      const comment = cellText(row, "comment").replace(/^—$/, "");
      // 集金を切り替えてよいのは出席の行だけ。製品の `canCollect` は画面の出欠ではなく
      // 行（サーバー）の出欠を見るので、下の select を動かしても切り替えは出さない。
      const attendingRow = (status || "出席") === "出席";
      // 表の集金の列は「済」だけで日時を持たない。注記の形（製品の `formatDateTimeJa`）を
      // 再現するため、日時は同じ行の回答日時を借りる。未集金は空にして注記を出さない。
      let collectedAt = /済/.test(cellText(row, "collected"))
        ? cellText(row, "createdAt").replace(/^要望\s*/, "")
        : "";

      const host = document.createElement("div");
      host.className = "modal modal--sheet modal--open";
      host.innerHTML =
        '<button type="button" class="modal__backdrop" aria-label="閉じる"></button>' +
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mock-roster-sheet-title" tabindex="-1">' +
        '<button type="button" class="dialog__close" aria-label="閉じる">' +
        icon("close") +
        "</button>" +
        '<h3 id="mock-roster-sheet-title" class="dialog__title"></h3>' +
        '<p class="dialog__body"></p>' +
        // 集金は保存のフォームの外に置く（製品の `ParticipantSheet` と同じ並び）。
        // 出席以外の行ではボタンを消し、記録できないことだけを伝える。
        '<div class="form--spaced">' +
        '<button type="button" class="btn btn--outline btn--block" data-mock-sheet-collect></button>' +
        '<p class="help alert__actions" data-mock-sheet-collected-at hidden></p>' +
        '<p class="help" data-mock-sheet-collect-help hidden>出席のときに記録できます。</p>' +
        "</div>" +
        '<div class="field"><label class="label" for="mock-roster-sheet-name">名前</label>' +
        '<input id="mock-roster-sheet-name" class="input" maxlength="100"></div>' +
        '<div class="field"><label class="label" for="mock-roster-sheet-status">出欠</label>' +
        '<select id="mock-roster-sheet-status" class="select">' +
        '<option value="出席">出席</option><option value="参加要望">参加要望</option><option value="欠席">欠席</option>' +
        "</select></div>" +
        '<div class="field" data-mock-sheet-attending><label class="label" for="mock-roster-sheet-gender">性別</label>' +
        '<select id="mock-roster-sheet-gender" class="select">' +
        '<option value="未設定">未設定</option><option value="男性">男性</option><option value="女性">女性</option>' +
        "</select></div>" +
        '<div class="field" data-mock-sheet-attending><label class="label" for="mock-roster-sheet-party">人数</label>' +
        '<input id="mock-roster-sheet-party" class="input" type="number" inputmode="numeric" min="1" max="20">' +
        '<p class="help">自分を含めた人数です。</p></div>' +
        '<div class="field" data-mock-sheet-attending><label class="label" for="mock-roster-sheet-plan">費用プラン</label>' +
        '<input id="mock-roster-sheet-plan" class="input"></div>' +
        '<div class="field"><label class="label" for="mock-roster-sheet-comment">コメント</label>' +
        '<input id="mock-roster-sheet-comment" class="input" maxlength="500"></div>' +
        '<div class="dialog__actions">' +
        '<button type="button" class="btn btn--primary btn--block" data-mock-sheet-save>保存する</button>' +
        '<button type="button" class="btn btn--danger btn--block" data-mock-sheet-delete>名簿から削除</button>' +
        "</div></div>";

      host.querySelector(".dialog__title").textContent = name;
      host.querySelector(".dialog__body").textContent =
        "いまは" + (status || "出席") + "。申込後に変わったことがあれば、ここで直します。";
      host.querySelector("#mock-roster-sheet-name").value = name;
      host.querySelector("#mock-roster-sheet-status").value = status || "出席";
      host.querySelector("#mock-roster-sheet-gender").value = gender || "未設定";
      host.querySelector("#mock-roster-sheet-party").value = partySize;
      host.querySelector("#mock-roster-sheet-plan").value = plan.replace(/^—$/, "");      host.querySelector("#mock-roster-sheet-comment").value = comment;

      const syncAttending = () => {
        const attending = host.querySelector("#mock-roster-sheet-status").value === "出席";
        for (const field of host.querySelectorAll("[data-mock-sheet-attending]")) {
          field.hidden = !attending;
        }
      };
      host.querySelector("#mock-roster-sheet-status").addEventListener("change", syncAttending);
      syncAttending();

      // 集金の切り替え。製品と同じ文言・同じ注記を出し、押したらその場で入れ替える。
      const collectButton = host.querySelector("[data-mock-sheet-collect]");
      const collectedNote = host.querySelector("[data-mock-sheet-collected-at]");
      const collectHelp = host.querySelector("[data-mock-sheet-collect-help]");

      const syncCollection = () => {
        collectButton.textContent = collectedAt ? "集金を戻す" : "集金済みにする";
        collectedNote.textContent = collectedAt ? collectedAt + " に集金" : "";
        collectedNote.hidden = !collectedAt;
      };

      if (attendingRow) {
        // API は呼ばない。押した瞬間に、その場の時刻で見た目だけを切り替える。
        collectButton.addEventListener("click", () => {
          collectedAt = collectedAt ? "" : new Date().toLocaleString("ja-JP");
          syncCollection();
        });
        syncCollection();
      } else {
        // 製品はボタンを描かない。`.btn` は `display` を持つので、hidden ではなく外す。
        collectButton.remove();
        collectHelp.hidden = false;
      }

      for (const button of host.querySelectorAll(
        ".dialog__close, .modal__backdrop, [data-mock-sheet-save], [data-mock-sheet-delete]",
      )) {
        button.addEventListener("click", close);
      }
      return host;
    };

    for (const row of rows) {
      const open = () => {
        if (modal && modal.isConnected) return;
        modal = build(row);
        document.body.append(modal);
        document.documentElement.setAttribute("data-scroll-lock", "true");
      };
      row.addEventListener("click", open);
      row.querySelector(".roster__open").addEventListener("click", open);
    }

    // 製品の `Dialog` は Escape でも閉じる。開いている間だけ拾う。
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal) close();
    });
  }


  // ---- 11. 料金プランの加入モーダル -------------------------------------

  /** 定価。`src/modules/billing/lib/plans.ts` と同じで、デモには価格キャンペーンが無い。 */
  const PLAN_PRICES = { single: 299, monthly8: 980, unlimited: 2980 };

  /** 画面の金額表記。`src/lib/format.ts` の `yen` / `yenMark` と同じ組み方。 */
  function yen(amount) {
    return amount.toLocaleString("ja-JP") + "円";
  }
  function yenMark(amount) {
    return "¥" + amount.toLocaleString("ja-JP");
  }

  /**
   * チケットの帯の「公開し放題プランを見る」「0円チケットを受け取る」から、
   * 加入モーダル（製品の `PricingModal`）を開く。
   *
   * **このダイアログだけ骨格を組み直す**のは、製品では押したときにしか出ず、
   * 撮った HTML に残らないため（8・9・10 と同じ扱い）。
   * 初月無料ははじめての月額加入だけなので、帯の文から未加入かどうかを見分け、
   * 未加入は「初月0円」の 2 段、加入済みは月額の金額を出す。金額の計算は
   * 製品と同じ（初月は 0、2 か月目からは 980 円 / 2,980 円、単発は 299 円）。
   */
  function wirePricingModal() {
    const LABELS = ["公開し放題プランを見る", "0円チケットを受け取る"];
    const triggers = Array.from(document.querySelectorAll("button")).filter((button) =>
      LABELS.includes((button.textContent || "").trim()),
    );
    if (triggers.length === 0) return;

    // 戻る道の文言は、開いた画面で変える（製品の `context`）。
    const CANCEL_LABELS = {
      "mock-create.html": "作成に戻る",
      "mock-edit.html": "編集に戻る",
      "mock-preview.html": "プレビューに戻る",
    };
    const file = (location.pathname.split("/").pop() || "").toLowerCase();
    const cancelLabel = CANCEL_LABELS[file] || "閉じる";

    /** 初月0円の 2 段。札の見出しは「初月0円」、下に 2 か月目の定価を置く。 */
    const trialPrice = (listPrice) =>
      '<p class="eyebrow" style="color:var(--color-primary-text)">初月0円</p>' +
      '<p class="stat__value">0<span style="margin-left:0.25rem;font-size:0.875rem;font-weight:500">円 / 初月</span></p>' +
      '<p class="help">2か月目から ' +
      yen(listPrice) +
      "（税込）</p>";

    /** 加入済み・キャンペーン用の 1 段。 */
    const price = (charged) =>
      '<p class="stat__value">' +
      yenMark(charged) +
      '</p><p class="help">（税込）</p>';

    const button = (plan, label, disabled, primary) =>
      '<button type="button" class="btn ' +
      (primary ? "btn--primary " : "") +
      'btn--block" data-mock-plan="' +
      plan +
      '"' +
      (disabled ? " disabled" : "") +
      ">" +
      label +
      "</button>";

    const build = (trigger) => {
      const banner = trigger.closest(".alert");
      const bannerText = banner ? banner.textContent || "" : "";
      const label = (trigger.textContent || "").trim();
      // 未加入は帯にチケットの残り枚数が出る。加入済みは公開中の件数が出る。
      const trialEligible = bannerText.includes("無料チケット 残り") || bannerText.includes("無料トライアル残り");
      const freeTicket = label === "0円チケットを受け取る";
      // 加入中のプランは帯の文で見分ける。8 件の上限に達した文も 8 件プランだけが出す。
      const currentPlan = bannerText.includes("公開し放題に加入中")
        ? "UNLIMITED"
        : bannerText.includes("月額プランで公開中のイベント") || bannerText.includes("件に達しました")
          ? "MONTHLY_8"
          : "NONE";

      const singlePrice = freeTicket
        ? '<p class="eyebrow" style="color:var(--color-primary-text)">全額無料</p>' +
          '<p class="stat__value">' +
          yenMark(0) +
          '<span style="margin-left:0.5rem;font-size:0.875rem;color:var(--color-text-faint);text-decoration:line-through">' +
          yenMark(PLAN_PRICES.single) +
          "</span></p>"
        : price(PLAN_PRICES.single);

      const single =
        '<article class="card">' +
        '<h4 class="card__title">単発チケット</h4>' +
        singlePrice +
        '<p class="card__body">1回分。スポット開催に。' +
        (freeTicket ? " おひとり1回まで無料です。" : "") +
        "</p>" +
        button("SINGLE", freeTicket ? "無料で受け取る" : "単発で購入する", false, false) +
        "</article>";

      const monthly8 =
        '<article class="card">' +
        (trialEligible ? "" : '<p class="eyebrow">公開中のイベントを同時に8件まで</p>') +
        '<h4 class="card__title">月額で8件まで公開プラン</h4>' +
        (trialEligible ? trialPrice(PLAN_PRICES.monthly8) : price(PLAN_PRICES.monthly8)) +
        '<p class="card__body">公開中は8件まで。終了したものと停止中は数えません。</p>' +
        button(
          "MONTHLY_8",
          currentPlan === "MONTHLY_8"
            ? "現在のプラン"
            : trialEligible
              ? "初月0円で始める"
              : "このプランを始める",
          currentPlan === "MONTHLY_8",
          false,
        ) +
        "</article>";

      // 公開し放題は製品でいちばん勧める 1 枚なので、枠を濃くする。
      const unlimited =
        '<article class="card" style="border-top:3px solid var(--color-primary)">' +
        (trialEligible ? "" : '<p class="eyebrow">公開中の件数を数えない</p>') +
        '<h4 class="card__title">公開し放題</h4>' +
        (trialEligible ? trialPrice(PLAN_PRICES.unlimited) : price(PLAN_PRICES.unlimited)) +
        '<p class="card__body">公開中の件数を数えません。教室や常設のイベント向けです。</p>' +
        button(
          "UNLIMITED",
          currentPlan === "UNLIMITED"
            ? "現在のプラン"
            : trialEligible
              ? "初月0円で始める"
              : "定期購入で公開し放題",
          currentPlan === "UNLIMITED",
          true,
        ) +
        "</article>";

      const notes =
        (trialEligible
          ? ""
          : '<p class="help" style="margin-top:0.75rem">初月無料は、はじめての月額プラン加入のみです。</p>') +
        '<p class="help" style="margin-top:1rem">初月無料の終了後は、登録したカードへ自動で請求します。3日前と1日前にメールでお知らせします。詳しくは' +
        '<a href="mock-terms.html" class="text-link">利用規約</a>をご確認ください。</p>';

      const host = document.createElement("div");
      host.className = "modal modal--open";
      host.innerHTML =
        '<button type="button" class="modal__backdrop" aria-label="閉じる"></button>' +
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mock-pricing-title" tabindex="-1">' +
        '<button type="button" class="dialog__close" aria-label="閉じる">' +
        icon("close") +
        "</button>" +
        '<h3 id="mock-pricing-title" class="dialog__title">プランを選ぶ</h3>' +
        // 製品の `Dialog` と同じく、本文だけを `.dialog__content` に入れて送る
        // （題と閉じる印は器に残す）。
        '<div class="dialog__content">' +
        '<p class="dialog__body">続けるには、どれかを選んでください。</p>' +
        '<div class="stack" style="margin-top:1.25rem">' +
        single +
        monthly8 +
        unlimited +
        "</div>" +
        notes +
        "</div>" +
        '<div class="dialog__actions">' +
        '<button type="button" class="btn btn--ghost btn--block" data-mock-pricing-close>' +
        cancelLabel +
        "</button>" +
        "</div></div>";
      return host;
    };

    let modal = null;

    const close = () => {
      if (!modal) return;
      modal.remove();
      modal = null;
      document.documentElement.removeAttribute("data-scroll-lock");
      for (const trigger of triggers) trigger.setAttribute("aria-expanded", "false");
    };

    for (const trigger of triggers) {
      // 帯のボタンは、ここの処理だけで開く（wireActions のトーストを出さない）。
      trigger.setAttribute("data-mock-wired", "true");
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-expanded", "false");

      trigger.addEventListener("click", () => {
        if (modal && modal.isConnected) return;
        modal = build(trigger);
        document.body.append(modal);
        document.documentElement.setAttribute("data-scroll-lock", "true");
        trigger.setAttribute("aria-expanded", "true");

        const dialog = modal.querySelector(".dialog");
        // 題と閉じる印は器に残したまま、本文の列（`.dialog__content`）だけが送られる。
        dialog.focus();

        for (const closer of modal.querySelectorAll(
          ".dialog__close, .modal__backdrop, [data-mock-pricing-close]",
        )) {
          closer.addEventListener("click", close);
        }
        // 加入の操作は Stripe の画面が要る。押した結果だけを返す。
        for (const plan of modal.querySelectorAll("[data-mock-plan]")) {
          plan.addEventListener("click", () => {
            if (plan.disabled) return;
            toast("モックでは実行しません（API が要ります）。");
          });
        }
      });
    }

    // 製品の `Dialog` は Escape でも閉じる。開いている間だけ拾う。
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal) close();
    });
  }

  // ---- 12. 公開の確認 ---------------------------------------------------

  /**
   * 製品の `PublishConfirmModal` の `CONFIRM_TEXT` と同じ題と、使うものの呼び方。
   * 単位はどれも枚にそろえる（「枠」「回」は使わない）。
   */
  const PUBLISH_CONFIRM_TEXT = {
    FREE_TICKET: { title: "チケットを使って公開しますか？", used: "チケットを1枚使います" },
    PAID_CREDIT: { title: "単発チケットを使って公開しますか？", used: "単発チケットを1枚使います" },
    FREE_TRIAL: { title: "無料チケットを使って公開しますか？", used: "無料チケットを1枚使います" },
  };

  /**
   * プレビュー画面の「公開する」から、公開前の確認の層（製品の `PublishConfirmModal`）を開き、
   * 公開後の「チケットを使いました」の層（製品の `PublishUsedModal`）までを再現する。
   *
   * 製品では、チケット・単発チケット・無料チケットを 1 枚使って公開するときだけ確認の層が出て、
   * 公開が通るとその層を閉じて 2 枚目を開く。どちらも押したときにしか出ず撮った HTML に
   * 残らないので、`wirePricingModal` と同じ写し方で骨格（`.modal` + `.dialog`）を組み直す。
   *
   * 何を 1 枚使うかは帯（`.alert--compact`）の文から読む。帯が残りを出していなければ
   * 定額が有効か上限に達している状態で、製品もこの層を出さない（402 は料金の層が受ける）。
   * そのときは API の要る操作として返事だけを出す。チケットの残りは帯に出ないので、
   * チケットが単発や無料チケットより先に使われる場合までは写せない。
   *
   * 2 枚目は閉じると告知ページへ移るが、モックは遷移先を持たない。閉じる道
   * （背景・右上・Escape・「告知ページを見る」）はすべて同じ返事にまとめ、層を閉じるだけにする。
   */
  function wirePublishConfirm() {
    // プレビュー画面の帯にある「公開する」だけを拾う。他の HTML では何もしない。
    const trigger = Array.from(document.querySelectorAll(".preview-toolbar button")).find(
      (button) => (button.textContent || "").trim() === "公開する",
    );
    if (!trigger) return;

    trigger.setAttribute("data-mock-wired", "true");

    // 帯の文は「無料チケット 残り 2枚（単発 1枚）…」の形。旧文言
    // （「無料トライアル残り 2回（単発 1回）」）も読めるようにしておく。数字だけを読む。
    const banner = document.querySelector(".alert--compact");
    const bannerText = (banner && banner.textContent) || "";
    const trialMatch =
      bannerText.match(/無料チケット\s*残り\s*(\d+)\s*枚/) ||
      bannerText.match(/無料トライアル残り\s*(\d+)\s*回/);
    const creditMatch = bannerText.match(/単発\s*(\d+)\s*[枚回]/);
    const trial = trialMatch ? Number(trialMatch[1]) : 0;
    const credits = creditMatch ? Number(creditMatch[1]) : 0;

    // 製品の順は チケット → 単発チケット → 無料チケット。帯から読めるのは単発と無料だけ。
    const kind = credits >= 1 ? "PAID_CREDIT" : trial >= 1 ? "FREE_TRIAL" : null;

    // 使うチケットを帯から読めないときは、製品と同じく確認を挟まない。
    if (!kind) {
      trigger.addEventListener("click", () => toast("モックでは実行しません（API が要ります）。"));
      return;
    }

    const part = PUBLISH_CONFIRM_TEXT[kind];
    const remaining = kind === "PAID_CREDIT" ? credits : trial;
    /** 確認で 1 枚使ったあとの残り。2 枚目の注記に出す。 */
    const remainingAfter = Math.max(0, remaining - 1);

    // 催し名は告知ページと同じ部品の h1 から取る。無ければチラシの題を使う。
    const heading =
      document.querySelector(".event-page h1") ||
      document.querySelector(".poster-hero__title") ||
      document.querySelector("h1");
    const eventTitle = ((heading && heading.textContent) || "").trim() || "このイベント";

    // 本文は「何を 1 枚使うか」と「公開するとどうなるか」だけを言う。
    // 残りは本文に混ぜず、下の `.dialog__note` に今の枚数だけを出す。
    const body =
      eventTitle +
      "。" +
      part.used +
      "。公開すると、告知URLが有効になり出欠を受け付けます。";

    const build = () => {
      const host = document.createElement("div");
      host.className = "modal modal--open";
      host.innerHTML =
        '<button type="button" class="modal__backdrop" aria-label="公開をやめる"></button>' +
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mock-publish-confirm-title" tabindex="-1">' +
        '<button type="button" class="dialog__close" aria-label="公開をやめる">' +
        icon("close") +
        "</button>" +
        '<h3 id="mock-publish-confirm-title" class="dialog__title"></h3>' +
        // 製品の `Dialog` と同じく、本文だけを `.dialog__content` に入れて送る
        // （題と閉じる印は器に残す）。
        '<div class="dialog__content">' +
        '<p class="dialog__body"></p>' +
        '<p class="dialog__note"></p>' +
        "</div>" +
        '<div class="dialog__actions">' +
        '<button type="button" class="btn btn--primary btn--block" data-mock-publish-confirm>' +
        "公開する" +
        "</button>" +
        '<button type="button" class="btn btn--ghost btn--block" data-mock-publish-close>' +
        "やめる" +
        "</button>" +
        "</div></div>";
      // 題と催し名は外から来る文字なので、HTML に混ぜず文字として入れる。
      host.querySelector(".dialog__title").textContent = part.title;
      host.querySelector(".dialog__body").textContent = body;
      host.querySelector(".dialog__note").textContent = "残りチケット数：" + remaining + "枚";
      return host;
    };

    /** 公開後に出す 2 枚目（製品の `PublishUsedModal`）。主操作は「告知ページを見る」1 つだけ。 */
    const buildUsed = () => {
      const host = document.createElement("div");
      host.className = "modal modal--open";
      host.innerHTML =
        '<button type="button" class="modal__backdrop" aria-label="告知ページを見る"></button>' +
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mock-publish-used-title" tabindex="-1">' +
        '<button type="button" class="dialog__close" aria-label="告知ページを見る">' +
        icon("close") +
        "</button>" +
        '<h3 id="mock-publish-used-title" class="dialog__title">チケットを使いました</h3>' +
        '<div class="dialog__content">' +
        '<p class="dialog__body"></p>' +
        '<p class="dialog__note"></p>' +
        "</div>" +
        '<div class="dialog__actions">' +
        '<button type="button" class="btn btn--primary btn--block" data-mock-publish-used>' +
        "告知ページを見る" +
        "</button>" +
        "</div></div>";
      // 催し名は外から来る文字なので、HTML に混ぜず文字として入れる。
      host.querySelector(".dialog__body").textContent = "「" + eventTitle + "」を公開しました。";
      host.querySelector(".dialog__note").textContent = "残りチケット数：" + remainingAfter + "枚";
      return host;
    };

    let modal = null;
    /** 公開後の 2 枚目。確認の層とは別に覚える。 */
    let usedModal = null;

    /** いま出ている層をすべて閉じる。2 枚目のあとは、本文の停止と印もここで戻す。 */
    const close = () => {
      if (!modal && !usedModal) return;
      if (modal) {
        modal.remove();
        modal = null;
      }
      if (usedModal) {
        usedModal.remove();
        usedModal = null;
      }
      document.documentElement.removeAttribute("data-scroll-lock");
      trigger.setAttribute("aria-expanded", "false");
    };

    /**
     * 2 枚目の閉じる道（背景・右上・Escape・「告知ページを見る」）。
     * 製品はどれも告知ページへ移るが、モックは遷移先を持たないので返事だけを出す。
     */
    const closeUsed = () => {
      if (!usedModal) return;
      toast("モックでは実行しません（API が要ります）。");
      close();
    };

    /** 確認の層を閉じて、公開後の層へ差し替える。本文の停止と印は次の層が引き継ぐ。 */
    const openUsed = () => {
      if (modal) {
        modal.remove();
        modal = null;
      }
      usedModal = buildUsed();
      document.body.append(usedModal);
      usedModal.querySelector(".dialog").focus();
      for (const closer of usedModal.querySelectorAll(
        ".modal__backdrop, .dialog__close, [data-mock-publish-used]",
      )) {
        closer.addEventListener("click", closeUsed);
      }
    };

    // 帯のボタンは、ここの処理だけで開く（`wireActions` のトーストを出さない）。
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");

    trigger.addEventListener("click", () => {
      if ((modal && modal.isConnected) || (usedModal && usedModal.isConnected)) return;
      modal = build();
      document.body.append(modal);
      document.documentElement.setAttribute("data-scroll-lock", "true");
      trigger.setAttribute("aria-expanded", "true");

      // 題と閉じる印は器に残したまま、本文の列（`.dialog__content`）だけが送られる。
      const dialog = modal.querySelector(".dialog");
      dialog.focus();

      // 「やめる」の道は、何も使わずに閉じる。
      for (const closer of modal.querySelectorAll(
        ".dialog__close, .modal__backdrop, [data-mock-publish-close]",
      )) {
        closer.addEventListener("click", close);
      }
      // 公開は API が要る。モックは公開が通った後だけを写し、2 枚目へ差し替える。
      modal.querySelector("[data-mock-publish-confirm]").addEventListener("click", openUsed);
    });

    // 製品の `Dialog` は Escape でも閉じる。2 枚目では、閉じたあと告知ページへ移る。
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (usedModal) closeUsed();
      else if (modal) close();
    });
  }

  // ---- 起動 -------------------------------------------------------------

  function start() {
    wireHeader();
    wireCalendar();
    wireSteps();
    wireVoice();
    wireListFilters();
    wireRsvpSheet();
    wireHeaderCrop();
    wireRosterColumns();
    wireRosterRowSheet();
    wirePricingModal();
    wirePublishConfirm();
    wireActions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
