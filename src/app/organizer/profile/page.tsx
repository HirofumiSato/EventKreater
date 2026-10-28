import type { Metadata } from "next";
import Link from "next/link";
import { OrganizerProfileForm } from "@/modules/organizers/components/OrganizerProfileForm";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "公開プロフィール",
  robots: { index: false, follow: false },
};

/**
 * 主催者の公開プロフィールの編集（SCR-ORG-14）。
 *
 * 主催者ホームと主催一覧から開く。参加者から見たページは `/organizers/[userId]`。
 */
export default function OrganizerProfilePage() {
  return (
    // スマホでは保存などの操作が画面下に固定される（`.profile-actions`）。
    // 最後の行が帯に隠れないよう、地の側で帯の高さぶん空ける。
    <div className="stack has-form-dock">
      <PageHeader
        title="公開プロフィール"
        lead="参加者が告知ページの主催者名から開くページです。どんな催しを開いている人かを、自己紹介とリンクで伝えます。アイコンとページの見た目も、ここで決められます。"
      />
      <OrganizerProfileForm />
      <p className="screen-note">
        表示名は
        <Link href="/account" className="text-link">
          アカウント設定
        </Link>
        で変えます。この画面では、肩書き・自己紹介・アイコンと、公開ページの見た目を扱います。保存の前に、参加者と同じ見た目でプレビューできます。
      </p>
    </div>
  );
}
