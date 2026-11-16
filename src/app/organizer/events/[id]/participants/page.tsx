import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { readPageIdentity } from "@/lib/server-session";
import { loadRosterForPage, type RosterPayload } from "@/modules/participants/lib/roster";
import { ParticipantsScreen } from "./ParticipantsClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

/**
 * 参加者名簿（SCR-ORG-06）。
 *
 * 名簿はサーバーで読んでクライアントへ渡す。催し名・集計帯・表の位置が最初の HTML に載る。
 * 権限は API と同じ順で確かめ、ゲスト幹事は会員登録の案内へ送る。
 */
export default async function ParticipantsPage({ params }: PageProps) {
  noStore();
  const identity = await readPageIdentity();
  const result = await loadRosterForPage(params.id, identity);

  if (result.status === "register-required") {
    redirect(`/organizer/register-required?eventId=${encodeURIComponent(params.id)}`);
  }

  let initialData: RosterPayload | null = null;
  let initialError: string | null = null;
  if (result.status === "ok") {
    initialData = result.data;
  } else if (result.status === "forbidden") {
    initialError = "このイベントの幹事権限がありません。";
  } else {
    initialError = "イベントが見つかりません。";
  }

  return <ParticipantsScreen eventId={params.id} initialData={initialData} initialError={initialError} />;
}
