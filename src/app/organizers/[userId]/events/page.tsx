import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { organizerProfileRedirectPath } from "@/modules/organizers/lib/public-page";

/** 参加者向けのページなので、検索結果には出さない。 */
export const metadata: Metadata = {
  title: "主催者のページ",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { userId: string };
  searchParams: { month?: string | string[] };
}

/**
 * 旧・主催者の催しページ。プロフィールと1画面に統合したので、
 * 統合ページ（`/organizers/[userId]`）へ恒久的に送る。月だけを引き継ぐ。
 */
export default function OrganizerEventsPage({ params, searchParams }: PageProps) {
  permanentRedirect(organizerProfileRedirectPath(params.userId, searchParams.month));
}
