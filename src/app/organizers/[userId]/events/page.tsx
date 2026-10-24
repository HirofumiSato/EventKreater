import type { Metadata } from "next";
import { Suspense } from "react";
import { OrganizerPageView } from "@/modules/organizers/components/OrganizerPageView";
import { Loading } from "@/components/ui";

/** 参加者向けのページなので、検索結果には出さない。 */
export const metadata: Metadata = {
  title: "主催者の催し",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function OrganizerEventsPage({ params }: { params: { userId: string } }) {
  return (
    <div className="page--narrow">
      <Suspense
        fallback={
          <Loading>
            読み込んでいます
          </Loading>
        }
      >
        <OrganizerPageView userId={params.userId} />
      </Suspense>
    </div>
  );
}
