// 撮った画面が「見つかりません」になっていないかを見る純ロジック。
//
// `storage/ui-demo.json` の ID が DB とずれると、主催者・催しの画面は 404 を返す。
// そのまま写すと、モックに「見つかりません」の絵が残り、画面の確認ができない
// （PR #90 で 12 画面がこの状態になっていた）。撮った直後にここで止める。
//
// 見るのは 2 つだけ。どちらもブラウザも DB も知らない値から判定できる。
//   応答 … `page.takeErrors().httpErrors`。期待どおりの 4xx は ui-browser が先に除く
//   題名 … `document.title`。Next.js の既定の 404 と、製品が自前で出す「〜が見つかりません」
//
// `npm run check` はソースの指紋しか見ないので、この検査は撮るときにしか回らない。
// 撮り直したときに気づくための網であって、撮ったあとの同期ずれは見つけられない。

/** `404 https://host/path` の 1 行から、状態と URL を分ける。 */
function splitEntry(entry) {
  const text = String(entry ?? "").trim();
  const space = text.indexOf(" ");
  if (space < 0) return null;
  const status = Number(text.slice(0, space));
  if (!Number.isFinite(status)) return null;
  return { status, url: text.slice(space + 1).trim() };
}

/**
 * 撮った 1 画面が壊れていないか。
 *
 * @param {{ httpErrors?: string[], title?: string, url: string }} input
 *   `url` は撮った画面の URL。同じ出所の応答だけを異常として数える
 * @returns {{ kind: "http" | "title", detail: string } | null} 壊れていなければ null
 */
export function captureProblem({ httpErrors = [], title = "", url }) {
  let origin = null;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }

  for (const entry of httpErrors) {
    const failed = splitEntry(entry);
    if (!failed) continue;
    if (failed.status < 400) continue;
    // 別のホスト（外部の画像・解析）はモックの写しに関係しない。
    if (origin) {
      try {
        if (new URL(failed.url).origin !== origin) continue;
      } catch {
        continue;
      }
    }
    return { kind: "http", detail: `${failed.status} ${failed.url}` };
  }

  const heading = String(title ?? "").trim();
  if (heading.length === 0) return null;
  // Next.js の既定の 404 は題名が `404: This page could not be found.` になる。
  if (/^\d{3}\s*:/.test(heading)) return { kind: "title", detail: heading };
  // 製品が自前で出す「見つかりません」（src/app/**/page.tsx の generateMetadata）。
  if (heading.includes("見つかりません")) return { kind: "title", detail: heading };
  return null;
}

/**
 * 画面を撮れなかったときの案内。原因の候補まで書く。
 * 画面の番号とファイル名は、呼び出し側のログ（`NG 04 mock-event.html ...`）が持つ。
 *
 * @param {{ kind: string, detail: string }} problem
 */
export function captureProblemMessage(problem) {
  return (
    `「見つかりません」の画面でした（${problem.detail}）。` +
    "storage/ui-demo.json の ID が DB に無い可能性があります。" +
    "`npm run db:seed:ui` でデモデータを作り直してから、撮り直してください。"
  );
}
