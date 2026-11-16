import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Alert } from "@/components/ui";
import { readNeedsHydrate, readPageIdentity } from "@/lib/server-session";
import { loadParticipantHome } from "@/modules/participants/lib/home";
import { ParticipantHomeScreen } from "./ParticipantClient";

export const dynamic = "force-dynamic";

/** ログインが要る画面の案内。参加者ホームは会員だけが開ける。 */
function LoginRequired({ message }: { message: string }) {
  return (
    <div className="page--narrow stack">
      <Alert tone="warning">
        {message}{" "}
        <Link href="/participant/login" className="text-link">
          参加者ログイン
        </Link>
      </Alert>
    </div>
  );
}

/**
 * 参加者ホーム（SCR-PUB-02）。
 *
 * 呼びかけ・要約・直近 3 件をサーバーで読み、クライアントへ 1 つのまとまりで渡す。
 * 出欠の引き継ぎ（/user/hydrate）が要る端末だけ、ハイドレーション後に 1 度呼ぶ。
 */
export default async function ParticipantHomePage() {
  noStore();
  const { userId } = await readPageIdentity();
  if (!userId) return <LoginRequired message="ログインが必要です。" />;

  try {
    const data = await loadParticipantHome(userId);
    if (!data) return <LoginRequired message="ログインが必要です。" />;
    return <ParticipantHomeScreen initial={data} needsHydrate={readNeedsHydrate()} />;
  } catch (cause) {
    return (
      <LoginRequired
        message={cause instanceof Error ? cause.message : "読み込みに失敗しました"}
      />
    );
  }
}
