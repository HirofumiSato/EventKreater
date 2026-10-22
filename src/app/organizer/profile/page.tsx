import type { Metadata } from "next";
import { OrganizerProfileForm } from "@/modules/organizers/components/OrganizerProfileForm";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";

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
    <div className="stack">
      <OrganizerTabs />
      <section className="panel">
        <div>
          <h1 className="page-title">公開プロフィール</h1>
          <p className="page-lead">
            参加者が告知ページの主催者名から開くページです。どんな催しを開いている人かを、自己紹介とリンクで伝えます。
          </p>
        </div>
      </section>
      <OrganizerProfileForm />
    </div>
  );
}
