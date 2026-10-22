import Link from "next/link";
import { SITE } from "@/lib/site";
import { WithdrawnNotice } from "@/modules/account/components/WithdrawnNotice";

/*
 * ホームの役割は「初見の幹事が、自分のためのサービスだと理解し、1つ作り始めること」。
 * 参加者は主催者が共有した告知URLから来るため、一覧・検索は置かない。
 * 料金の比較は /service に任せ、ここでは主操作を1つに絞る。
 */

const HERO_EYEBROW = "町内会・サークル・勉強会の幹事へ";
const HERO_LEAD =
  "催し名・日時・場所を入れると、告知ページとチラシができます。あとはURLを送るだけで、参加者は登録なしで出欠を答えられ、集計も自動で揃います。";

/** 幹事に起きること。機能名ではなく、手間がどう減るかで書く。 */
const capabilities = [
  [
    "チラシと告知ページが、同時にできる",
    "開催情報を入れると、縦長のチラシと告知ページをまとめて作ります。チラシは告知ページの先頭に載ります。",
  ],
  [
    "参加者は、名前と出欠だけ",
    "メールもパスワードも不要です。同じブラウザなら、次回から自分の回答を表示します。",
  ],
  [
    "集計も、リマインドも、ここで",
    "出欠は自動で集計されます。開催が近づいたら、名簿から参加者へ案内を送れます。",
  ],
  [
    "いくら集まるか、先に分かる",
    "費用プランと出欠から、見込みの売上を自動で計算します。何人集まれば赤字にならないかを、集金の前に確かめられます。会員登録した幹事から使えます。",
  ],
  [
    "幹事が何人いても、誰の催しか分かる",
    "主催者と共同主催者を分けて、告知ページに名前を出します。招待できるのは会員の幹事で、利用枠を消費するのはイベントを公開した主催者だけです。",
  ],
];

const steps = [
  [
    "1",
    "催しの情報を入れる",
    "催し名・日時・場所・費用を入れて公開します。チラシはその場で生成されます。",
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

export default function HomePage() {
  return (
    <div className="stack">
      <WithdrawnNotice />
      <section className="hero hero--stage">
        <div className="hero__grid">
          <div className="hero__copy">
            <p className="hero__eyebrow">{HERO_EYEBROW}</p>
            <h1 className="hero__title">{SITE.tagline}</h1>
            <p className="hero__lead">{HERO_LEAD}</p>
            <div className="hero__actions">
              <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--lg">
                無料でイベントを作る
              </Link>
              <Link href={SITE.nav.service.href} className="text-link">
                料金を見る
              </Link>
            </div>
          </div>
          <figure className="hero__poster">
            <img src="/samples/flyer-autumn.jpg" alt="生成されたチラシの例（秋の芋煮会）" width={1080} height={1920} />
            <figcaption>入力した内容から、このチラシができます。</figcaption>
          </figure>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">幹事の手間を、5つに減らす</h2>
          <p className="section__note">告知・出欠・集計・お金・運営を、1つのURLにまとめます。</p>
        </div>
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
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">使い方</h2>
          <p className="section__note">入力から共有まで、3ステップです。</p>
        </div>
        <ol className="step-list">
          {steps.map(([, title, body]) => (
            <li key={title} className="step-row">
              <h3 className="step-row__title">{title}</h3>
              <p className="step-row__body">{body}</p>
            </li>
          ))}
        </ol>
      </section>

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
              無料でイベントを作る
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
