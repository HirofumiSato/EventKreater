import type { Metadata } from "next";
import { Suspense } from "react";
import { OrganizerPageView } from "@/modules/organizers/components/OrganizerPageView";

/** 参加者向けのページなので、検索結果には出さない。 */
export const metadata: Metadata = {
  title: "主催者の催し",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function OrganizerPublicPage({ params }: { params: { userId: string } }) {
  return (
    <div className="page--narrow">
      <Suspense
        fallback={
          <p className="loading">
            <span className="spinner" aria-hidden="true" />
            読み込んでいます
          </p>
        }
      >
        <OrganizerPageView userId={params.userId} />
      </Suspense>
    </div>
  );
}
