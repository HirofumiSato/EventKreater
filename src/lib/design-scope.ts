/**
 * 画面の装飾スコープ。パスだけから決まる純関数にして、テストで取りこぼしを止める。
 *
 * - `pop`   … 導入。初めて触る人の画面。影を硬く、少し傾け、暖色を使う。
 * - `quiet` … 管理。毎日見る人の画面。傾けず、枠線と淡い影だけにする。
 * - `none`  … 装飾しない。管理コンソールは装飾を比べる画面ではない。
 *
 * 判定は `SiteChrome` が 1 回だけ行い、ラッパーのクラスに落とす。
 * 画面ごとにクラスを書くと、増えたときに必ずずれる。
 */
export type DesignScope = "pop" | "quiet" | "none";

/** 前方一致はパスの区切りまで見る。`/organizerX` を `/organizer` と誤認しないため。 */
function matches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * パスからスコープを決める。
 *
 * `quiet` の例外は「新規イベント作成」だけ。ここは初めて触る人が最初に開く画面なので、
 * 主催者の管理画面に属していても導入の見た目にする。
 */
export function designScope(pathname: string): DesignScope {
  if (!pathname) return "pop";
  if (matches(pathname, "/console")) return "none";
  if (matches(pathname, "/organizer/events/new")) return "pop";
  if (matches(pathname, "/mypage")) return "quiet";
  if (matches(pathname, "/organizer")) return "quiet";
  return "pop";
}

/** ラッパーに付けるクラス。`none` は何も付けない。 */
export function decoClassName(scope: DesignScope): string {
  switch (scope) {
    case "pop":
      return "deco deco--tape deco--tape-shadow";
    case "quiet":
      return "deco deco--tape deco--tape-quiet";
    default:
      return "";
  }
}
