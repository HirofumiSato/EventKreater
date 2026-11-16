import { cookies } from "next/headers";
import { sha256 } from "@/lib/crypto";
import { verifyLocalToken } from "@/modules/auth/lib/auth";
import { AUTH_COOKIE, AUTH_COOKIE_HOST } from "@/modules/auth/lib/cookies";

/**
 * サーバーコンポーネントから、リクエストの Cookie だけで身元を読む。
 *
 * API の `resolveUserId` / `collectGuestTokenHashes` は `NextRequest` を受けるため、
 * 画面（サーバーコンポーネント）ではそのまま使えない。同じ Cookie の見方だけを
 * ここ 1 箇所に置き、画面ごとに書き分けない。
 */

export interface PageIdentity {
  /** 会員のセッション。未ログイン・セッション切れは null。 */
  userId: string | null;
  /** ゲスト幹事の `org_token_*` をハッシュにしたもの。 */
  guestTokenHashes: string[];
}

const RSVP_COOKIE_PREFIX = "rsvp_token_";
const ORGANIZER_COOKIE_PREFIX = "org_token_";

export async function readPageIdentity(): Promise<PageIdentity> {
  const store = cookies();
  const token = store.get(AUTH_COOKIE_HOST)?.value ?? store.get(AUTH_COOKIE)?.value ?? null;
  const verified = token ? await verifyLocalToken(token) : null;
  const guestTokenHashes = store
    .getAll()
    .filter((cookie) => cookie.name.startsWith(ORGANIZER_COOKIE_PREFIX) && cookie.value)
    .map((cookie) => sha256(cookie.value));
  return { userId: verified?.userId ?? null, guestTokenHashes };
}

/**
 * 端末だけの出欠・幹事トークンが残っているか。
 * 残っている端末だけが `POST /api/v1/user/hydrate` を呼ぶ（`/api/v1/user/profile` と同じ判定）。
 */
export function readNeedsHydrate(): boolean {
  return cookies()
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith(RSVP_COOKIE_PREFIX) || cookie.name.startsWith(ORGANIZER_COOKIE_PREFIX),
    );
}
