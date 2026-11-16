import Link from "next/link";
import { ProblemDetailException } from "@/lib/exceptions";
import { formatDateWithWeekdayJa, formatDateTimeJa } from "@/lib/format";
import { readPageIdentity } from "@/lib/server-session";
import { previewInvitation } from "@/modules/organizers/lib/invitations";
import { RAIN_POLICY_LABELS } from "@/modules/events/types";
import { Alert, PageHeader } from "@/components/ui";
import { AcceptInvitation } from "./AcceptInvitation";

/**
 * 共同主催・幹事の招待着地。
 *
 * 招待の中身はサーバーで引いて、そのまま HTML に載せる（`previewInvitation` を直接呼ぶ。
 * 画面のために API を 1 往復しない）。クライアントに残すのは受諾の POST だけ。
 *
 * 無効・期限切れのコードでも 500 にしない。以前の画面と同じ文言と組み方で
 * 「招待を表示できません」を出す。
 */
export const dynamic = "force-dynamic";

type Preview = Awaited<ReturnType<typeof previewInvitation>>;

/** 招待を読む。無効なコードは理由を文言として返し、それ以外の失敗は汎用の文言にする。 */
async function readInvitation(code: string): Promise<{ preview: Preview | null; error: string | null }> {
  try {
    return { preview: await previewInvitation(code), error: null };
  } catch (cause) {
    if (cause instanceof ProblemDetailException) {
      return { preview: null, error: cause.detail };
    }
    console.error("招待の読み取りに失敗しました", cause);
    return { preview: null, error: "招待を確認できません" };
  }
}

/** 受諾のボタンと登録の導線を出し分けるためだけに、ログイン中かを見る。 */
async function readLoggedIn(): Promise<boolean> {
  const identity = await readPageIdentity();
  return identity.userId !== null;
}

export default async function InvitationPage({ params }: { params: { code: string } }) {
  const [{ preview, error }, loggedIn] = await Promise.all([
    readInvitation(params.code),
    readLoggedIn(),
  ]);

  if (!preview) {
    return (
      <div className="page--form stack">
        <h1 className="page-title">共同主催・幹事の招待</h1>
        <p className="page-lead">招待を表示できません。</p>
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }

  const loginHref = `/auth/register?next=${encodeURIComponent(`/invitations/${params.code}`)}`;

  return (
    <div className="page--form stack">
      <PageHeader eyebrow="招待" title="共同主催・幹事に加わりますか" lead={<>{preview.event.title}</>} />
      <div className="auth-card">
        <h2 className="auth-card__title">{preview.event.organizer.ownerName ?? "主催者"} からの招待</h2>
        <p className="auth-card__note">
          加わると、このイベントの編集と名簿を分担できます。チケットは消費しません。
        </p>
        <dl className="kv">
          <div className="kv__row">
            <dt>開催</dt>
            <dd>{preview.event.schedules.map((row) => `${formatDateWithWeekdayJa(row.eventDate)} ${row.eventTime}`).join("、")}</dd>
          </div>
          <div className="kv__row">
            <dt>場所</dt>
            <dd>{preview.event.location}</dd>
          </div>
          <div className="kv__row">
            <dt>料金</dt>
            <dd>{preview.event.pricePlans.map((row) => `${row.name} ${row.price}`).join("、")}</dd>
          </div>
          <div className="kv__row">
            <dt>雨天</dt>
            <dd>{RAIN_POLICY_LABELS[preview.event.rainPolicy]}</dd>
          </div>
        </dl>
        <p className="help">有効期限 {formatDateTimeJa(preview.invitation.expiresAt)}</p>
        <div className="panel__actions">
          {loggedIn ? (
            <AcceptInvitation code={params.code} />
          ) : (
            <>
              <p className="help">
                共同主催・幹事として参加するには会員登録が必要です。登録すると、このイベントの編集と名簿を分担できます。チケットは消費しません。
              </p>
              <Link href={loginHref} className="btn btn--primary btn--block">
                会員登録して受諾する
              </Link>
              <Link
                href={`/auth/register?mode=login&next=${encodeURIComponent(`/invitations/${params.code}`)}`}
                className="btn btn--ghost btn--block"
              >
                すでに会員の方はログイン
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
