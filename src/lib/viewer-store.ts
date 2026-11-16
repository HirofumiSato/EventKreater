import type { Viewer } from "@/lib/site-nav";

/**
 * ヘッダーが使う「いま誰として入っているか」を、モジュールに 1 つだけ持つ。
 *
 * `Navbar` と通知のフックは、画面を移るたびに `/api/v1/user/profile` を叩いていた。
 * 名前と役割は画面を移っても変わらないので、最初の 1 回だけ取り、以後は同じ Promise を
 * 使い回す。変わるのは「ログアウトした」「表示名を保存した」ときだけなので、その 2 か所が
 * `invalidateViewer()` を呼ぶ。呼ばれたら捨てて取り直し、購読者（ヘッダー）へ配る。
 *
 * 401（未ログイン）も答えなので、そのまま覚える。通信そのものが失敗したときだけは
 * 覚えず、次の機会に取り直す。
 */

interface ViewerResponse {
  user?: { name?: unknown; platformRole?: unknown };
  isOrganizer?: unknown;
}

type ViewerListener = (viewer: Viewer | null) => void;

/** 取得中の Promise。解決後も同じ値を返し続ける。 */
let cached: Promise<Viewer | null> | null = null;

/** 取り直した結果を受け取りたいヘッダー。 */
const listeners = new Set<ViewerListener>();

function toViewer(data: ViewerResponse): Viewer | null {
  const name = typeof data.user?.name === "string" ? data.user.name : "";
  // 名前が無い応答は「読めなかった」と同じに扱う。空の札は出さない。
  if (!name) return null;
  return {
    name,
    isOrganizer: data.isOrganizer === true,
    platformRole: data.user?.platformRole === "ADMIN" ? "ADMIN" : "MEMBER",
  };
}

async function requestViewer(): Promise<Viewer | null> {
  let response: Response;
  try {
    response = await fetch("/api/v1/user/profile", {
      headers: { Accept: "application/json" },
    });
  } catch {
    // 通信そのものが失敗した。答えではないので覚えない（次の画面で取り直す）。
    cached = null;
    return null;
  }
  if (!response.ok) {
    // 5xx も答えではない。401/403/404 は「ログインしていない」で確定。
    if (response.status >= 500) cached = null;
    return null;
  }
  try {
    return toViewer((await response.json()) as ViewerResponse);
  } catch {
    // 本文が読めないだけ。ヘッダーは未ログインの見た目にする。
    return null;
  }
}

/** 閲覧者を読む。2 回目からは同じ Promise を返す。 */
export function loadViewer(): Promise<Viewer | null> {
  if (!cached) cached = requestViewer();
  return cached;
}

/** 取り直した結果を受け取る。返り値は購読の解除。 */
export function subscribeViewer(listener: ViewerListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 閲覧者が変わった（ログアウト・表示名の保存）。覚えている値を捨てて取り直し、
 * 購読者へ配る。呼んだ側は待たなくてよい。
 */
export function invalidateViewer(): void {
  cached = null;
  void loadViewer().then((viewer) => {
    for (const listener of listeners) listener(viewer);
  });
}
