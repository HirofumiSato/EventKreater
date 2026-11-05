import Link from "next/link";
import { SITE } from "@/lib/site";
import { yen } from "@/lib/format";
import { FREE_EVENT_LIMIT, ONE_TIME_PRICE_JPY, SERVICE_PLANS } from "@/modules/billing/lib/plans";
import { WithdrawnNotice } from "@/modules/account/components/WithdrawnNotice";
import { PlanCard, Row, Rows, Section, SectionHead } from "@/components/ui";

/*
 * ホームの役割は「初見の幹事が、自分のためのサービスだと理解し、1つ作り始めること」。
 * 参加者は主催者が共有した告知URLから来るため、一覧・検索は置かない。
 * 料金の比較は /service に任せ、ここでは主操作を1つに絞る。
 */

const HERO_EYEBROW = (
  <>
    ご飯会、交流会、ライブ、一日店長、撮影会、合コン etc.{" "}
    <span className="hero__eyebrow-tail">主催者様へ</span>
  </>
);
const HERO_LEAD =
  "イベント名・日時・場所・費用を入れるだけ。チラシと告知ページができ、URLを送るだけで出欠が揃います。";
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
 * 主操作の直下に置く条件。`SITE.cta.freeNote` は /sample も読むため変えず、
 * ホームだけの言い方（初回の無料チケット2枚の付与）をここに持つ。
 */
const HERO_NOTE = "初回、無料チケット2枚付与。";
/**
 * ヒーローのログイン導線。`SITE.nav.*.label` はヘッダー・フッターも読むので変えず、
 * ホームだけ「登録」も選べる言い方に上書きする。
 */
const HERO_LOGIN_LINKS = [
  { href: SITE.nav.organizerLogin.href, prefix: "主催者", suffix: "登録/ログイン" },
  { href: SITE.nav.participantLogin.href, prefix: "参加者", suffix: "登録/ログイン" },
] as const;

/**
 * h1 の 1 行。1 行目の「告知」「申込」だけを文字色で分ける。
 * 文言は `SITE.taglineLines` が持ち、ここは色分けのためだけに分割する。
 */
function renderTagline(line: string) {
  return line.split(/(告知|申込)/).map((part, index) => {
    if (part === "告知") {
      return (
        <span key={index} className="hero__mark hero__mark--notice">
          告知
        </span>
      );
    }
    if (part === "申込") {
      return (
        <span key={index} className="hero__mark hero__mark--apply">
          申込
        </span>
      );
    }
    return part;
  });
}

/** 幹事に起きること。機能名ではなく、手間がどう減るかで書く。 */
const capabilities = [
  [
    "イベントの告知と申込の特設ページが、5分で作れる",
    "イベント名・日時・場所・費用を入れると、縦長のチラシと告知ページをまとめて作ります。チラシは告知ページの先頭に載り、そのまま共有できます。",
  ],
  [
    "参加者は、名前と出欠だけ",
    "メールもパスワードも不要です。同じブラウザなら、次回から自分の回答を表示します。",
  ],
  [
    "出欠の集計も、費用の計算も、ここで",
    "出欠は自動で集計されます。参加者名簿で、誰が来るかといくら集まるかを確かめられます。",
  ],
  [
    "いくら集まるか、先に分かる",
    "費用プランと出欠から、見込みの売上を自動で計算します。何人集まれば赤字にならないかを、集金の前に確かめられます。会員登録した幹事から使えます。",
  ],
  [
    "一つのイベント情報を、複数幹事で共有できる",
    "主催者と共同主催者で、同じイベントの情報を編集できます。招待できるのは会員の幹事で、チケットを消費するのはイベントを公開した主催者だけです。",
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
    "イベント名・日時・場所・費用を入れるだけ。チラシと告知ページはその場で生成され、5分ほどで公開できます。",
  ],
  [
    "2",
    "URLをLINEで送る",
    "できあがった告知ページのURLを、LINE・Instagram・Xなどでそのまま共有します。",
  ],
  [
    "3",
    "出欠が自動で揃う",
    "参加者は名前と出欠だけで回答します。幹事は参加者名簿で集計を確認し、見込みの売上も同じ流れで確かめられます。",
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
              改行の位置は文言の一部。どの幅も 2 行のままで、文字サイズだけを
              幅に合わせて上げる（CSS の .hero__title が持つ）。幅で DOM を変えない。
              吹き出しは最後の行の右に横へ 2 枚並べる。最後の行だけが短いので、
              狭い端末でも見出しを折り返さずに横へ並べられる。
            */}
            <h1 className="hero__title">
              {SITE.taglineLines.map((line, index) =>
                index === SITE.taglineLines.length - 1 ? (
                  <span key={line} className="hero__title-row">
                    <span className="hero__title-line">{renderTagline(line)}</span>
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
                ) : (
                  <span key={line} className="hero__title-line">
                    {renderTagline(line)}
                  </span>
                ),
              )}
            </h1>
            <p className="hero__lead">{HERO_LEAD}</p>
            <div className="hero__actions">
              <div className="hero__buttons">
                <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--lg">
                  {SITE.cta.createEventFree}
                </Link>
                {/*
                  作る前に、自分の催しならどう見えるかを確かめる入口。主操作の隣に
                  副のボタンとして並べる。見本は別のタブで開き、作りかけの入力を失わない。
                */}
                <Link
                  href={SITE.nav.sample.href}
                  className="btn btn--outline btn--lg"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {SITE.nav.sample.label}
                </Link>
              </div>
              {/* 無料の条件はボタンに詰めず、押す直前に 1 行だけ添える。 */}
              <p className="hero__note">{HERO_NOTE}</p>
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
          <figure className="hero__poster">
            <img src="/samples/flyer-autumn.jpg" alt="実際に作ったチラシ（秋の芋煮会）" width={1080} height={1528} />
            <figcaption>実際に作ったチラシ</figcaption>
          </figure>
        </div>
      </section>

      <Section>
        <SectionHead title="幹事の手間を、6つに減らす" note="案内ページづくりを5分に。出欠・集計・お金・運営・日程も、1つのURLにまとめます。" />
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
