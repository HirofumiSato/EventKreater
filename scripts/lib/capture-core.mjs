// モックを撮るための、ブラウザと DB の細かい仕事。
//
//   scripts/mock-sync.mjs  … これを組み合わせて 1 周を回す
//
// ここに置くのは「1 画面を開く前に整えること」と「ページから素材を取ること」。
// HTML の整形そのものは scripts/lib/mock-html.mjs（ブラウザを知らない純ロジック）。

import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { SignJWT } from "jose";

import { openTarget, sleep } from "./ui-browser.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** 編集画面の URL から催しの ID を取る。編集画面でなければ null。 */
export function editEventId(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/organizer\/events\/([^/]+)\/edit(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 前回の実行が残した編集ロックを消す。
 *
 * ロックは期限で切れない（保持者が解放するまで残る）。撮影はページを閉じる
 * ときに解放を投げるが、途中で落ちた回のぶんは残る。残ると次の実行の編集画面が
 * 「他の人が編集中」になり、モックがその状態で上書きされる。
 */
export async function clearEventLock(eventId) {
  const prisma = new PrismaClient();
  try {
    await prisma.eventLock.deleteMany({ where: { eventId } });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 確認用の会員を探す。
 *
 * 一度撮ると、その会員のアドレスは `emailChangeTargets` のどれかへ変わっている。
 * 元のアドレスだけで探すと 2 回目から見つからない。
 */
async function findVerifyUser(prisma, demo) {
  const emails = [
    demo.accounts?.verifyUser?.email,
    ...Object.values(demo.emailChangeTargets ?? {}),
  ].filter(Boolean);
  if (emails.length === 0) return null;
  return prisma.user.findFirst({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
}

/**
 * メールアドレス変更の確認トークンを発行し直す。
 *
 * この画面は開いた時点でトークンを消費する（1 回しか使えない）。そのまま 2 回
 * 同期すると 2 回目がエラー画面になるので、撮る前に同じ値で作り直す。
 * 表示される新しいアドレスは `storage/ui-demo.json` の `emailChangeTargets`。
 */
export async function reissueEmailChangeTokens(demo) {
  const tokens = demo.emailChangeTokens;
  const targets = demo.emailChangeTargets;
  if (!tokens || !targets) return false;

  const prisma = new PrismaClient();
  try {
    const user = await findVerifyUser(prisma, demo);
    if (!user) return false;

    const hashes = Object.values(tokens).map(sha256);
    await prisma.emailChangeRequest.deleteMany({ where: { tokenHash: { in: hashes } } });
    await prisma.emailChangeRequest.createMany({
      data: Object.entries(tokens).map(([width, token]) => ({
        userId: user.id,
        newEmail: targets[width],
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })),
    });
    return true;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 確認用の会員のセッションを 1 本発行し直す。
 *
 * メールアドレスの変更は、他の端末のセッションを失効させる。撮るたびに
 * `storage/ui-demo.json` の `tokens.verifyUser` が死に、12 のヘッダーだけが
 * 未ログインの見た目になる。撮る前に同じ会員で発行し直して、これを防ぐ。
 * 返すのは Cookie に入れる生のトークン（DB には jti で行だけ作る）。
 */
export async function reissueVerifyUserSession(demo) {
  const secret = process.env.JWT_SECRET;
  const userIdFromDemo = demo.accounts?.verifyUser?.email;
  if (!userIdFromDemo || !secret || secret.length < 32) return null;

  const prisma = new PrismaClient();
  try {
    const user = await findVerifyUser(prisma, demo);
    if (!user) return null;

    // 撮るたびに 1 本増えるので、前の回のぶんは消す（この会員は 12 専用）。
    await prisma.authSession.deleteMany({ where: { userId: user.id } });
    const session = await prisma.authSession.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    return await new SignJWT({ userId: user.id, email: user.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setJti(session.id)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(secret));
  } finally {
    await prisma.$disconnect();
  }
}

/** ページから HTML を丸ごと取る。水和が終わったあとの DOM。 */
export async function readHtml(page) {
  return page.evaluate("document.documentElement.outerHTML");
}

/**
 * 隠し DOM を集めるための目印を付ける。見た目は変えない（属性だけ）。
 *
 *   カレンダーの日セル   … `data-mock-date="YYYY-MM-DD"`（月見出しの年と、セルの読み上げから作る）
 *   日別セクション       … `data-mock-cal-section` / `data-mock-cal-date`（いま選んでいる日）
 *   ステップの `<li>`    … `data-mock-step-key`、開いている本文に `data-mock-step-body`
 *
 * **`readHtml` の前に呼ぶこと。** 読み取った HTML にだけ目印が入り、製品の画面には残らない
 * （ページは撮り終えたら閉じる）。カレンダーの無い画面・ステップの無い画面では何もしない。
 */
export async function markVariants(page) {
  return page.evaluate(`(() => {
    const result = { steps: 0, days: 0, section: "" };

    const cal = document.querySelector(".cal");
    if (cal) {
      const monthText = (cal.querySelector(".cal__month") || {}).textContent || "";
      const yearMatch = monthText.match(/([0-9]{4})/);
      const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
      const monthMatch = monthText.match(/([0-9]{1,2})月/);

      let selected = null;
      for (const cell of cal.querySelectorAll(".cal__day")) {
        if (cell.classList.contains("is-outside")) continue;
        const button = cell.querySelector(".cal__select");
        if (!button) continue;

        const label = button.getAttribute("aria-label") || "";
        const labelMatch = label.match(/([0-9]{1,2})月([0-9]{1,2})日/);
        const dayText = (cell.querySelector(".cal__day-number") || {}).textContent || "";
        const month = labelMatch ? Number(labelMatch[1]) : monthMatch ? Number(monthMatch[1]) : 0;
        const day = labelMatch ? Number(labelMatch[2]) : Number(dayText.trim());
        if (!month || !day) continue;

        const iso =
          String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
        cell.setAttribute("data-mock-date", iso);
        result.days += 1;
        if (button.getAttribute("aria-pressed") === "true") selected = iso;
      }

      // 日別の一覧は、カレンダーのすぐ次にある section。カレンダー自体が section に
      // 包まれている画面（主催者の公開ページ）があるので、包みの次も見る。
      const host = cal.closest("section") || cal;
      let section = host.nextElementSibling;
      while (section && section.tagName !== "SECTION") section = section.nextElementSibling;
      if (section && selected) {
        section.setAttribute("data-mock-cal-section", "true");
        section.setAttribute("data-mock-cal-date", selected);
        result.section = selected;
      }
    }

    for (const item of document.querySelectorAll(".event-step")) {
      const toggle = item.querySelector(".event-step__toggle");
      const body = item.querySelector(".event-step__body");
      const id = (toggle && toggle.getAttribute("aria-controls")) || (body && body.id) || "";
      const key = id.replace(/^event-step-/, "");
      if (!key || key === id) continue;
      item.setAttribute("data-mock-step-key", key);
      if (body) body.setAttribute("data-mock-step-body", key);
      result.steps += 1;
    }

    return result;
  })()`);
}

/**
 * 閉じているステップの本文と、選んでいない日の一覧を集める。
 *
 * 製品の画面を実際に押して、製品が描いた DOM をそのまま持ち帰る（値も見た目も作らない）。
 * 押した状態は最後に戻すが、**撮影のあとに呼ぶこと**（押している間の画面を残さない）。
 */
export async function collectVariants(page, { maxDays = 31 } = {}) {
  return page.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const out = { steps: {}, calendarDays: {} };

    const steps = Array.from(document.querySelectorAll(".event-step"));
    for (const item of steps) {
      const key = item.getAttribute("data-mock-step-key");
      if (!key) continue;
      if (item.querySelector(".event-step__body")) continue;
      const toggle = item.querySelector(".event-step__toggle");
      if (!toggle) continue;
      toggle.click();
      await wait(160);
      const body = document.getElementById("event-step-" + key);
      if (body) out.steps[key] = body.outerHTML;
      toggle.click();
      await wait(80);
    }

    const cal = document.querySelector(".cal");
    if (cal) {
      const monthText = (cal.querySelector(".cal__month") || {}).textContent || "";
      const yearMatch = monthText.match(/([0-9]{4})/);
      const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
      const monthMatch = monthText.match(/([0-9]{1,2})月/);

      // 目印（data-mock-date）は React の再描画で消えることがあるので、日付は毎回
      // 読み上げ文から作り直す。押す対象は「何番目のセルか」で覚える。
      const dateOf = (cell) => {
        const button = cell.querySelector(".cal__select");
        if (!button) return "";
        const label = button.getAttribute("aria-label") || "";
        const labelMatch = label.match(/([0-9]{1,2})月([0-9]{1,2})日/);
        const dayText = (cell.querySelector(".cal__day-number") || {}).textContent || "";
        const month = labelMatch ? Number(labelMatch[1]) : monthMatch ? Number(monthMatch[1]) : 0;
        const day = labelMatch ? Number(labelMatch[2]) : Number(dayText.trim());
        if (!month || !day) return "";
        return String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      };

      const cells = () =>
        Array.from(cal.querySelectorAll(".cal__day")).filter(
          (cell) =>
            !cell.classList.contains("is-outside") && cell.querySelector(".cal__select"),
        );

      const all = cells();
      const selectedIndex = all.findIndex((cell) => {
        const button = cell.querySelector(".cal__select");
        return button && button.getAttribute("aria-pressed") === "true";
      });

      const daySection = () => {
        const host = cal.closest("section") || cal;
        let section = host.nextElementSibling;
        while (section && section.tagName !== "SECTION") section = section.nextElementSibling;
        return section;
      };

      const withEvents = [];
      const withoutEvents = [];
      all.forEach((cell, index) => {
        (cell.classList.contains("has-event") ? withEvents : withoutEvents).push(index);
      });
      // 予定のある日を先に、そのあと空いている日。全部そろえると、どの日を押しても
      // その日の一覧が出る（空の日は同じ文面だが、見出しの日付は日ごとに違う）。
      const targets = withEvents
        .concat(withoutEvents)
        .filter((index) => index !== selectedIndex)
        .slice(0, ${Number(maxDays)});

      for (const index of targets) {
        const cell = cells()[index];
        if (!cell) continue;
        const button = cell.querySelector(".cal__select");
        if (!button) continue;
        button.click();
        await wait(180);
        const section = daySection();
        const date = dateOf(cells()[index] || cell);
        if (section && date) out.calendarDays[date] = section.outerHTML;
      }

      // 元の日へ戻してから、画面の先頭へ。撮影はこの前に済ませてある。
      if (selectedIndex >= 0) {
        const restored = cells()[selectedIndex];
        const button = restored ? restored.querySelector(".cal__select") : null;
        if (button) {
          button.click();
          await wait(180);
        }
      }
      window.scrollTo(0, 0);
    }

    return out;
  })()`);
}

/**
 * ページの Cookie を使って 1 つの素材を取りに行く。
 *
 * CDP の評価で base64 にして返す。画像は数 100KB になるが、1 画面あたり数枚なので
 * 十分速い。相対 URL は開いているページを基準に解決される。
 */
export async function fetchResource(page, url) {
  const result = await page.evaluate(`(async () => {
    try {
      const response = await fetch(${JSON.stringify(url)}, { credentials: "same-origin" });
      const type = response.headers.get("content-type") || "";
      if (!response.ok) return { ok: false, status: response.status, type };
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
      }
      return { ok: true, status: response.status, type, base64: btoa(binary), size: bytes.length };
    } catch (error) {
      return { ok: false, status: 0, type: "", message: String(error) };
    }
  })()`);

  if (!result?.ok) return { ok: false, status: result?.status ?? 0, type: result?.type ?? "" };
  return {
    ok: true,
    status: result.status,
    type: result.type,
    size: result.size,
    buffer: Buffer.from(result.base64, "base64"),
  };
}

/** 内部 URL か（取りに行く対象か）。外部・data:・blob: は触らない。 */
export function isSameOrigin(url, baseUrl) {
  if (!url) return false;
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  if (url.startsWith("//")) return false;
  if (url.startsWith("/")) return true;
  return url.startsWith(baseUrl);
}

/**
 * 1 行（画面 × 状態）を開くためのタブを用意する。
 * ログインは Cookie なので、タブごとにコンテキストを分けて他の行と混ぜない。
 */
export async function openCapturePage(browser, { webUrl, tokens }) {
  return openTarget(browser, {
    isolate: true,
    baseUrl: webUrl,
    tokens,
    waitProfile: "fast",
  });
}

/** 幅を変えたあと、行が動き終わるのを待つ。遷移はしない。 */
export async function settle(page) {
  await sleep(150);
  await page.waitForStable();
}
