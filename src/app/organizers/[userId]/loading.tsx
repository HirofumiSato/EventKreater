import { Section, SectionHead, Skeleton } from "@/components/ui";

/**
 * 主催者の公開ページの読み込み中。プロフィールの器と催しの枠を先に描き、
 * 中身だけを待たせる。画面全体を回る〇へ置き換えない。
 */
export default function OrganizerProfileLoading() {
  return (
    <div className="stack" aria-busy="true">
      <Skeleton height="11rem" shape="card" />
      <Section className="section--tight">
        <SectionHead title="次の催し" />
        <Skeleton height="6rem" shape="card" />
      </Section>
      <Section>
        <SectionHead title="カレンダー" />
        <Skeleton height="18rem" shape="card" />
      </Section>
      <Section>
        <SectionHead title="一覧" />
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
      </Section>
      <p className="visually-hidden" role="status">
        主催者のページを読み込んでいます
      </p>
    </div>
  );
}
