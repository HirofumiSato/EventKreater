import Link from "next/link";
import { SITE } from "@/lib/site";
import { yen } from "@/lib/format";
import { FREE_EVENT_LIMIT, ONE_TIME_PRICE_JPY, SERVICE_PLANS } from "@/modules/billing/lib/plans";
import { WithdrawnNotice } from "@/modules/account/components/WithdrawnNotice";
import { Badge, PlanCard, Row, Rows, Section, SectionHead } from "@/components/ui";
import { HomeShowcase } from "./HomeShowcase";

/*
 * ホームの役割は「初見の主催者が、自分のためのサービスだと理解し、1つ作り始めること」。
 * 参加者は主催者が共有した告知URLから来るため、一覧・検索は置かない。
 * 料金の比較は /service に任せ、ここでは主操作を1つに絞る。
 */

const HERO_EYEBROW = (
  <>
    店舗イベント、パフォーマーの企画ライブ、一日店長、マルシェ、ご飯会 etc.{" "}
    <span className="hero__eyebrow-tail">主催者様へ</span>
  </>
);
const HERO_LEAD =
  "イベント名・日時・場所・料金を入れるだけ。告知ページができ、URLを送るだけで集客と予約管理が完結します。";
/**
 * 見出しの最後の行の右に横に並べる吹き出し。見出しが主、これは添え書き。
 * 左から「作れるもの」「そのあとも使えるもの」の順に置く。
 * 文言は意味の切れ目で 2 行に折る（幅で折ると語の途中で切れる）。
 * 各要素は 30 文字以内に収め、実装の言葉（カレンダー機能名など）は使わない。
 */
const HERO_CALLOUTS = [
  ["チラシも", "簡単自動生成"],
  ["カレンダー共有も", "できる"],
] as const;
/**
 * ヒーローのログイン導線。`SITE.nav.*.label` はヘッダー・フッターも読むので変えず、
 * ホームだけ「登録」も選べる言い方に上書きする。
 */
const HERO_LOGIN_LINKS = [
  { href: SITE.nav.organizerLogin.href, prefix: "主催者", suffix: "登録/ログイン" },
  { href: SITE.nav.participantLogin.href, prefix: "参加者", suffix: "登録/ログイン" },
] as const;

/**
 * h1 の 1 つ目の文。見出しは白の 1 色にそろえ、冒頭の「イベント告知&申込」だけを
 * 山吹のアンダーラインマーカーで受け止める。文言は `SITE.taglineLines` が持ち、
 * ここはマーカーを引く範囲を示すためだけに分割する。
 */
const HERO_MARKER = "イベント告知&申込";

function renderTagline(line: string) {
  const [before, after] = line.split(HERO_MARKER);
  if (after === undefined) return line;
  return (
    <>
      {before}
      <span className="hero__marker">{HERO_MARKER}</span>
      {after}
    </>
  );
}

/** 主催者に起きること。機能名ではなく、手間がどう減るかで書く。 */
const capabilities = [
  [
    "イベントの告知と申込の特設ページが、5分で作れる",
    "イベント名・日時・場所・料金を入れると、縦長のチラシと告知ページをまとめて作ります。チラシは告知ページの先頭に載り、そのまま共有できます。",
  ],
  [
    "参加者は、名前と出欠だけ",
    "メールもパスワードも不要です。同じブラウザなら、次回から自分の回答を表示します。",
  ],
  [
    "出欠の集計も、料金の計算も、ここで",
    "出欠は自動で集計されます。参加者名簿で、誰が来るかといくら集まるかを確かめられます。",
  ],
  [
    "いくら集まるか、先に分かる",
    "料金プランと出欠から、見込みの売上を自動で計算します。何人集まれば赤字にならないかを、集金の前に確かめられます。会員登録した主催者から使えます。",
  ],
  [
    "一つのイベント情報を、主催者と共同主催・幹事で共有できる",
    "招待した共同主催・幹事と、同じイベントの情報を編集できます。招待できるのは会員の主催者で、チケットを消費するのはイベントを公開した主催者だけです。",
  ],
  [
    "カレンダーで月ごとの予定が、1画面で分かる",
    "自分のイベントをカレンダーに並べます。開催日が複数あるイベントも、すべての日付で出ます。日付を選ぶと、その日の出欠確認へ進めます。",
  ],
];

const steps = [
  [
    "1",
    "イベントの情報を入れる",
    "イベント名・日時・場所・料金を入れるだけ。チラシと告知ページはその場で生成され、5分ほどで公開できます。",
  ],
  [
    "2",
    "URLをLINEで送る",
    "できあがった告知ページのURLを、LINE・Instagram・Xなどでそのまま共有します。",
  ],
  [
    "3",
    "出欠が自動で揃う",
    "参加者は名前と出欠だけで回答します。主催者は参加者名簿で集計を確認し、見込みの売上も同じ流れで確かめられます。",
  ],
];

/**
 * 月額プランだけ。どれが初月無料かは `plans.ts` の `trialMonths` が持つ。
 * ホームでは金額を比べさせず、初月0円だけを予告する。
 */
const monthlyPlans = SERVICE_PLANS.filter((plan) => plan.trialMonths > 0);

export default function HomePage() {
  return (
    <div className="stack">
      <WithdrawnNotice />
      <section className="hero hero--stage">
        <div className="hero__grid">
          <div className="hero__copy">
            <p className="hero__eyebrow">{HERO_EYEBROW}</p>
            {/*
              改行の位置は文言の一部。幅で行数も並びも変えず、文字サイズだけを
              幅に合わせて上げる（CSS の .hero__title が持つ）。幅で DOM を変えない。
              1 つ目の文は折らずに 1 段に置き、残りの句は 1 段に横へ並べる。
              最後の段に吹き出しを 2 枚添え、入りきらないときは束だけを次の行へ落とす。
            */}
            <h1 className="hero__title">
              <span className="hero__title-line">{renderTagline(SITE.taglineLines[0])}</span>
              <span className="hero__title-row">
                {SITE.taglineLines.slice(1).map((line) => (
                  <span key={line} className="hero__title-line">
                    {renderTagline(line)}
                  </span>
                ))}
                <span className="hero__callouts">
                  {HERO_CALLOUTS.map((lines) => (
                    <span key={lines[0]} className="hero__callout">
                      {lines.map((calloutLine) => (
                        <span key={calloutLine} className="hero__callout-line">
                          {calloutLine}
                        </span>
                      ))}
                    </span>
                  ))}
                </span>
              </span>
            </h1>
            <p className="hero__lead">{HERO_LEAD}</p>
            <div className="hero__actions">
              <div className="hero__buttons">
                <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--lg">
                  {SITE.cta.createEventFree}
                </Link>
                {/*
                  作る前に、自分の催しならどう見えるかを確かめる入口。見本はまだ準備中なので、
                  遷移させず、押せないボタンとして置き、右上に「準備中」の札を重ねる。
                  公開するときは、この要素を href={SITE.nav.sample.href} の Link に戻す。
                */}
                <span className="hero__sample">
                  <button type="button" className="btn btn--outline btn--lg" disabled>
                    {SITE.nav.sample.label}
                  </button>
                  <span className="hero__sample-badge">
                    <Badge tone="warning" small>
                      準備中
                    </Badge>
                  </span>
                </span>
              </div>
              {/* ホームは共通ヘッダーを出さない。主催者と参加者の入口はヒーローに残す。 */}
              <p className="hero__links">
                {HERO_LOGIN_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} className="text-link">
                    {link.prefix}
                    <span className="hero__link-suffix">{link.suffix}</span>
                  </Link>
                ))}
              </p>
            </div>
          </div>
          <HomeShowcase />
        </div>
      </section>

      <Section>
        <SectionHead title="主催者の手間を、6つに減らす" note="案内ページづくりを5分に。出欠・集計・お金・運営・日程も、1つのURLにまとめます。" />
        <ul className="feature-list">
          {capabilities.map(([title, body], index) => (
            <li key={title} className="feature-row">
              <span className="feature-row__index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="feature-row__title">{title}</h3>
              <p className="feature-row__body">{body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <SectionHead title="使い方" note="入力から共有まで、5分・3ステップです。" />
        <ol className="step-list">
          {steps.map(([, title, body]) => (
            <li key={title} className="step-row">
              <h3 className="step-row__title">{title}</h3>
              <p className="step-row__body">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/*
        料金の予告。比較は /service が受け持つので、ここは月額2枚だけを並べる。
        主操作（朱）はヒーローの1つに絞ったまま、詳しい料金は枠線のボタンへ回す。
      */}
      <Section>
        <SectionHead title="月額プランは、初月0円。" />
        {/* 月額に進む前に、単発で足りる人の金額を先に出す。行の形は共通の Rows が持つ。 */}
        <div className="plan-single">
          <p className="plan-single__label">単発で公開するなら</p>
          <Rows>
            <Row
              title="無料チケット"
              meta="単発の公開に使えます。"
              aside={<span className="rows__value">{FREE_EVENT_LIMIT}枚</span>}
            />
            <Row
              title="単発チケット"
              meta="足りないときに1枚から。"
              aside={<span className="rows__value">{yen(ONE_TIME_PRICE_JPY)} / 1枚</span>}
            />
          </Rows>
        </div>
        <ul className="plan-list plan-list--pair">
          {monthlyPlans.map((plan) => (
            /* ホームでは説明文を出さない。金額と初月0円だけを見せ、比較は /service に任せる。 */
            <PlanCard key={plan.id} plan={plan} showBody={false} />
          ))}
        </ul>
        <div className="panel__actions panel__actions--end">
          <Link href={SITE.nav.service.href} className="btn btn--outline">
            料金の詳細を見る
          </Link>
        </div>
      </Section>

      <section className="cta-band">
        <div className="cta-band__inner">
          <div>
            <h2 className="cta-band__title">まずは1つ、無料で作ってみる。</h2>
            <p className="cta-band__note">
              参加者として出欠を答える方は、主催者から届いた告知URLを開いてください。イベントの一覧・検索はありません。
            </p>
          </div>
          <div className="cta-band__actions">
            <Link href={SITE.nav.createEvent.href} className="btn btn--inverse">
              {SITE.cta.createEventFree}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
