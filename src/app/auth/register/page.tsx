import { AuthEntryScreen } from "@/modules/auth/components/AuthEntryScreen";
import { loadReferralInvite } from "@/modules/account/lib/referral-invite";

/**
 * 主催者（幹事）の入口。参加者として使うときは /participant/login へ。
 * 中身は参加者入口と共通で、文言と着地だけを差し替えている。
 *
 * 紹介リンク（`?ref=<code>`）から来たときは、紹介者の名前を先に引いて画面へ渡す。
 * 登録画面は Cookie を書くためにクライアントで動くが、名前の問い合わせはここで 1 回だけ行う。
 */

interface PageProps {
  searchParams: { ref?: string | string[] };
}

export default async function RegisterPage({ searchParams }: PageProps) {
  const ref = typeof searchParams.ref === "string" ? searchParams.ref.trim() : "";
  const invite = ref ? await loadReferralInvite(ref) : null;
  return <AuthEntryScreen audience="organizer" inviteName={invite?.name ?? null} />;
}
