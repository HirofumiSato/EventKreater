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
//
// 値や文言を作り直すのは、音声入力のサンプルと、押したときにしか出ない
// 絞り込みモーダルの中身だけ。他の表示は製品の DOM のまま動かす。
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

  function labelOf(field) {
    const labels = field.labels;
    const text = labels && labels.length > 0 ? (labels[0].textContent || "").trim() : "";
    return text || field.getAttribute("aria-label") || field.placeholder || "この項目";
  }

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
      fields.push({ field, label: labelOf(field), value });
    }
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
    panel.className = "voice-panel";
    panel.setAttribute("aria-label", "音声入力");
    panel.innerHTML =
      '<div class="voice-panel__head">' +
      '<p class="voice-panel__status" hidden>' +
      '<span class="voice-rec" aria-hidden="true"><span class="voice-rec__dot"></span>REC</span>' +
      '<span class="voice-panel__state"></span>' +
      "</p>" +
      '<p class="voice-panel__prompt" aria-live="polite"></p>' +
      '<button type="button" class="voice-panel__close" aria-label="音声入力を終了" title="音声入力を終了">' +
      icon("close") +
      "</button></div>" +
      '<p class="voice-panel__hint"></p>' +
      '<p class="voice-panel__message" role="status" hidden></p>' +
      '<div class="voice-panel__actions">' +
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
      '<button type="button" class="voice-icon-btn" data-voice-prev aria-label="戻る" title="戻る">' +
      icon("left") +
      "</button>" +
      '<button type="button" class="voice-icon-btn" data-voice-skip aria-label="スキップ" title="スキップ">' +
      icon("right") +
      "</button></div>" +
      '<div class="voice-panel__options">' +
      '<label class="check voice-panel__optional"><input type="checkbox" data-voice-optional> 任意の項目も聞く</label>' +
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

  /** 対象の欄を四角く残して、まわりを暗くする。 */
  function measureSpotlight() {
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
    window.setTimeout(measureSpotlight, 320);

    voice.panel.querySelector(".voice-panel__prompt").textContent = entry.label + "は？";
    const hint = voice.panel.querySelector(".voice-panel__hint");
    hint.textContent = "例: " + entry.value;
    hint.hidden = false;
    voice.panel.querySelector(".voice-panel__status").hidden = true;
    voice.panel.querySelector(".voice-panel__message").hidden = true;
    voice.panel.querySelector("[data-voice-optional]").closest(".check").hidden = false;
    voice.panel.querySelector("[data-voice-auto]").closest(".check").hidden = false;
    voice.panel.querySelector("[data-voice-prev]").disabled = index === 0;
  }

  function startListening() {
    if (!voice.active || voice.busy) return;
    const status = voice.panel.querySelector(".voice-panel__status");
    status.hidden = false;
    voice.panel.querySelector(".voice-panel__state").textContent = "録音中";
    voice.panel.querySelector(".voice-panel__message").hidden = true;
    voice.listening = true;
    setTalkIcon("stop");
    clearTimers();
    later(finishListening, 2600);
  }

  function finishListening() {
    if (!voice.listening) return;
    voice.listening = false;
    voice.busy = true;
    setTalkIcon("busy");
    voice.panel.querySelector(".voice-panel__state").textContent = "文字にする…";
    later(applyListening, 700);
  }

  function applyListening() {
    const entry = voice.fields[voice.cursor];
    if (!entry) {
      finishVoice();
      return;
    }
    const field = entry.field;
    field.value = entry.value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));

    field.classList.add("voice-filled");
    window.setTimeout(() => field.classList.remove("voice-filled"), 900);

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
    voice.fields = voiceFields();
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
      clearTimers();
      pointAt(voice.cursor - 1);
    });
    voice.panel.querySelector("[data-voice-skip]").addEventListener("click", () => {
      clearTimers();
      pointAt(voice.cursor + 1);
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

  /** API を呼ばないと進まないボタン。押したら「モックでは実行しません」と返す。 */
  const API_ACTIONS = new Set([
    "公開する",
    "ログインして公開/下書き保存",
    "下書き保存",
    "保存する",
    "更新する",
    "公開を一時停止",
    "公開を再開",
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
    "LINEで送る",
  ]);

  const NAVIGATES = new Map([
    ["コピー作成", "mock-create.html"],
    ["プレビューを見る", "mock-preview.html"],
    ["ログアウト", "mock-home.html"],
  ]);

  /** この JS が動かしている操作。押してもトーストを出さない。 */
  const WIRED = ".site-header, .cal, .event-step__toggle, .event-step__next, .voice-fab, .list-filters";

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
        '<div class="filter-dialog"></div>' +
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

  // ---- 起動 -------------------------------------------------------------

  function start() {
    wireHeader();
    wireCalendar();
    wireSteps();
    wireVoice();
    wireListFilters();
    wireActions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
