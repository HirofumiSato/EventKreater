import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Alert } from "@/components/ui";
import { loginUrl } from "@/lib/auth-links";
import { ProblemDetailException } from "@/lib/exceptions";
import { readNeedsHydrate, readPageIdentity } from "@/lib/server-session";
import { loadQuotaSeed } from "@/modules/billing/lib/quota-view";
import { loadReferralSummary } from "@/modules/billing/lib/referral";
import { loadNotificationInbox } from "@/modules/notifications/lib/inbox";
import { loadOrganizerEvents, splitDraftEvents } from "@/modules/organizers/lib/event-list";
import { readOrganizerProfileDraft } from "@/modules/organizers/lib/profile-store";
import { organizerProfilePath } from "@/modules/organizers/lib/public-page";
import { MyPageScreen, type MyPageData } from "./MyPageClient";

export const dynamic = "force-dynamic";

/** ログインが要る画面の案内。参加履歴と違い、主催者マイページは会員だけが開ける。 */
function LoginRequired({ message }: { message: string }) {
  return (
    <Alert tone="warning">
      {message}{" "}
      <Link href={loginUrl("/mypage")} className="text-link">
        主催者ログイン
      </Link>
    </Alert>
  );
}

/**
 * 主催者マイページ（SCR-PUB-03）。
 *
 * 会員・主催イベント・公開プロフィール・新着を 1 度に読み、クライアントへ 1 つの
 * まとまりで渡す。ヘッダー・集計・直近の催しが最初の HTML に載る。
 */
export default async function MyPage() {
  noStore();
  const { userId } = await readPageIdentity();
  if (!userId) return <LoginRequired message="ログインが必要です。" />;

  try {
    const data = await loadMyPage(userId);
    return <MyPageScreen initial={data} />;
  } catch (cause) {
    const message =
      cause instanceof ProblemDetailException
        ? cause.detail
        : cause instanceof Error
          ? cause.message
          : "読み込みに失敗しました";
    return <LoginRequired message={message} />;
  }
}

/**
 * マイページの初期データ。
 *
 * 会員名・催し・公開プロフィール・新着・クォータ・紹介は互いに依存しないので 1 ウェーブで引く。
 * 会員名は催しの一覧を引くときに一緒に読めるので、会員の行をもう一度読まない。
 * クォータと紹介は、読めなくても残りを描けるよう、失敗をここで握る。
 */
async function loadMyPage(userId: string): Promise<MyPageData> {
  const [organizerEvents, ownDraft, inbox, quota, referral] = await Promise.all([
    loadOrganizerEvents({ userId, guestTokenHashes: [] }),
    readOrganizerProfileDraft(userId),
    loadNotificationInbox(userId, 5),
    // 読めなかったら `unknown`。画面は今までどおり帯の位置にクライアントで取りに行く。
    loadQuotaSeed(userId),
    // 紹介が読めないときは紙を出さないだけ。マイページの他の操作は続けられる。
    loadReferralSummary(userId).catch(() => null),
  ]);

  // 主催一覧は下書きも返す。マイページの要約と件数は、公開済みと受付停止だけを数える。
  const { events } = splitDraftEvents(organizerEvents.events);
  // 催しを 1 件でも持つ会員が主催者（/api/v1/user/profile の isOrganizer と同じ数え方）。
  const isOrganizer = organizerEvents.events.length > 0;

  return {
    profile: {
      name: organizerEvents.viewer.name ?? "",
      isOrganizer,
      needsHydrate: readNeedsHydrate(),
    },
    events,
    // 主催者だけが公開プロフィールを持つ。まだイベントが無い会員は節を出さない。
    ownProfile: isOrganizer
      ? { isPublished: ownDraft.isPublished, homePath: organizerProfilePath(userId) }
      : null,
    notifications: inbox.notifications,
    unreadCount: inbox.unreadCount,
    quota,
    referral,
  };
}
