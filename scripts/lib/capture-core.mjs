// モックを撮るための、ブラウザと DB の細かい仕事。
//
//   scripts/mock-sync.mjs  … これを組み合わせて 1 周を回す
//
// ここに置くのは「1 画面を開く前に整えること」と「ページから素材を取ること」。
// HTML の整形そのものは scripts/lib/mock-html.mjs（ブラウザを知らない純ロジック）。

import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

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
    const user = await prisma.user.findUnique({
      where: { email: demo.accounts.verifyUser.email },
      select: { id: true },
    });
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

/** ページから HTML を丸ごと取る。水和が終わったあとの DOM。 */
export async function readHtml(page) {
  return page.evaluate("document.documentElement.outerHTML");
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
