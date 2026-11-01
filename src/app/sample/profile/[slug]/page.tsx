import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SemanticThemeScope } from "@/components/ui";
import { SITE } from "@/lib/site";
import { OrganizerProfileView } from "@/modules/organizers/components/OrganizerProfileView";
import { profileBioExcerpt } from "@/modules/organizers/lib/profile";
import { findProfile, SAMPLE_PROFILES } from "../../profiles";

/**
 * 見本の主催者プロフィール（SCR-PUB-18）。
 *
 * 本物の公開プロフィール（SCR-PUB-14）と同じ `OrganizerProfileView` を、同じ順で置く。
 * 違いは 2 つだけ。催しの一覧を載せないことと、末尾に「見本である」ことを書くこと。
 * 一覧（`/sample/profile`）は作らず、`/sample` のカードからだけ開く。
 * 見本を検索結果に載せない（本物の主催者と紛れるため）。
 */
interface PageProps {
  params: { slug: string };
}

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return SAMPLE_PROFILES.map((profile) => ({ slug: profile.slug }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const profile = findProfile(params.slug);
  if (!profile) {
    return { title: "サンプルが見つかりません", robots: { index: false, follow: false } };
  }
  const description =
    profileBioExcerpt(profile.profile.bio, 110) ?? `${profile.name}さんの見本のプロフィールです。`;
  return {
    title: `${profile.name}さん（サンプル）`,
    description,
    robots: { index: false, follow: false },
  };
}

export default function SampleProfilePage({ params }: PageProps) {
  const profile = findProfile(params.slug);
  if (!profile) notFound();

  return (
    <div className="page--narrow">
      <SemanticThemeScope themeId={profile.profile.themeId} page>
        <div className="stack">
          {/* 製品向けの注記は、見本では意味が変わるので出さない。 */}
          <OrganizerProfileView name={profile.name} profile={profile.profile} showNote={false} />
          <p className="screen-note">
            見本のため、主催者は架空です。催しの一覧は省いています。
          </p>
          <p className="page-lead">
            <Link href={`${SITE.nav.sample.href}#sample-profiles`} className="text-link">
              ほかのプロフィールを見る
            </Link>
          </p>
        </div>
      </SemanticThemeScope>
    </div>
  );
}
