import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { PageHeader } from "@/components/ui";
import { PublicThemeShell } from "@/components/common/PublicThemeShell";
import { ReferralInviteCard } from "@/modules/account/components/ReferralInviteCard";
import { loadReferralInvite } from "@/modules/account/lib/referral-invite";
import { REFERRAL_TICKET_GRANT, REFERRAL_TICKET_MONTHS } from "@/modules/billing/lib/tickets";

/**
 * 紹介の着地ページ（SCR-PUB-19）。
 *
 * 紹介リンクを踏んだ人が最初に見る画面。紹介者の名前と、登録すると何が起きるかだけを出す。
 * 無効なコード・退会者でも 404 にしない。共有された古いリンクからの流入を落とさず、
 * 同じ画面で登録の入口だけを残す。検索結果には出さない。
 */

export const dynamic = "force-dynamic";

/** metadata と本文で同じ問い合わせを繰り返さないよう、リクエスト内で1回にまとめる。 */
const loadInvite = cache(loadReferralInvite);

interface PageProps {
  params: { code: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const invite = await loadInvite(params.code);
  if (!invite) {
    return {
      title: "紹介リンクが無効です",
      robots: { index: false, follow: false },
    };
  }
  const description = `${invite.name}さんからの紹介です。登録してイベントを公開すると、${invite.name}さんにチケット${REFERRAL_TICKET_GRANT}枚が届きます。`;
  return {
    title: `${invite.name}さんからの紹介`,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: `${invite.name}さんからの紹介`,
      description,
      type: "website",
      // アイコンがあれば添える。無ければ既定の OGP 画像に任せる。
      ...(invite.avatarUrl ? { images: [invite.avatarUrl] } : {}),
    },
  };
}

export default async function ReferralInvitePage({ params }: PageProps) {
  // 前後の空白はコードの形に含めない。引き当てた値と、登録へ渡す値を同じにする。
  const code = params.code.trim();
  const invite = await loadInvite(code);

  if (!invite) {
    // 無効なコードでもパスは同じで、`siteChrome()` はここで `main: false` を返す。
    // テーマは無いが、器に `<main>` とフッターを任せて素の画面に戻さない。
    return (
      <PublicThemeShell themeId={null}>
        <div className="page--narrow">
          <div className="stack">
            <PageHeader title="紹介リンクが無効です" />
            <div className="panel__actions">
              <Link href="/auth/register" className="btn btn--primary btn--block">
                登録してはじめる
              </Link>
            </div>
          </div>
        </div>
      </PublicThemeShell>
    );
  }

  const registerHref = `/auth/register?ref=${encodeURIComponent(code)}`;

  return (
    <PublicThemeShell themeId={invite.themeId}>
      <div className="page--narrow">
        <div className="stack">
          <PageHeader title={`${invite.name}さんからの紹介`} />
          <ReferralInviteCard
            name={invite.name}
            headline={invite.headline}
            bio={invite.bio}
            avatarUrl={invite.avatarUrl}
          />
          <p>
            {`このリンクから登録し、はじめてイベントを公開すると、${invite.name}さんにチケット${REFERRAL_TICKET_GRANT}枚が届きます。`}
          </p>
          <p className="help">{`チケットは発行から${REFERRAL_TICKET_MONTHS}か月使えます。`}</p>
          <div className="panel__actions">
            <Link href={registerHref} className="btn btn--primary btn--block">
              登録してはじめる
            </Link>
            <Link href={`${registerHref}&mode=login`} className="btn btn--ghost btn--block">
              会員の方はログイン
            </Link>
          </div>
        </div>
      </div>
    </PublicThemeShell>
  );
}
