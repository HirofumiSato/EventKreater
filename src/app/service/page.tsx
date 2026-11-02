import Link from "next/link";
import {
  buildServicePlans,
  SUBSCRIPTION_8_PRICE_JPY,
  SUBSCRIPTION_UNLIMITED_PRICE_JPY,
} from "@/modules/billing/lib/plans";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteAll } from "@/modules/billing/lib/pricing";
import { yen } from "@/lib/format";
import { SITE } from "@/lib/site";
import { Alert, PageHeader, PlanCard, Row, Rows, Section, SectionHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const capabilities = [
  ["チラシから告知", "開催情報から縦長のチラシを作り、告知ページの先頭に載せます。"],
  ["名前と出欠だけ", "参加者はメールもパスワードも不要です。同じブラウザなら、次回から自分の回答を表示します。"],
  ["見込みの売上", "費用プランと出欠から、見込みの売上を自動で計算します。集金した額と並べて、集金の前に確かめられます。会員登録した幹事から使えます。"],
  ["主催者と共同主催", "主催者と共同主催者を分けて、告知ページに名前を出します。招待された共同主催者は編集と名簿を分担でき、利用枠を消費するのはイベントを公開した主催者だけです。"],
  ["イベントの日程をカレンダーで見る", "自分が幹事のイベントを月表示で並べます。開催日が複数あるイベントも、すべての日付で出ます。日付を選ぶと、その日の出欠確認へ進めます。"],
];

/* よくある質問。条文の正は /terms。ここは要約だけを置き、重複した詳細は書かない。 */
const faqs = [
  [
    "参加者からは料金を取りますか",
    "取りません。参加者が答えるのは出欠だけで、参加費はイベントの主催者へ直接お支払いください。",
  ],
  [
    "初月無料は何回使えますか",
    "はじめて月額プランに加入するときの1回だけです。解約して再加入しても、もう一度は使えません。",
  ],
  [
    "2か月目からいくらですか",
    `月額で8件まで公開プランは ${yen(SUBSCRIPTION_8_PRICE_JPY)}、公開し放題は ${yen(SUBSCRIPTION_UNLIMITED_PRICE_JPY)}（いずれも税込）です。`,
  ],
  [
    "途中で解約できますか",
    "月額はいつでも解約できます。解約しても、次の更新までは使えます。日割りの返金はしません。",
  ],
  [
    "キャンペーン価格は、あとから変わりますか",
    "すでに購入した回の金額は変わりません。実施中のキャンペーンは、購入前に販売価格と定価を並べて表示します。初月無料とは併用しません。",
  ],
  [
    "月額で8件まで公開プランと公開し放題の違いは",
    "同時に公開しておけるイベント数だけです。月額で8件まで公開プランは8件まで、公開し放題は上限がありません。どちらも、開催が終わったイベントと公開を一時停止したイベント、削除したイベントは数えません。含まれる機能は同じです。",
  ],
];

/* 初月無料の流れ。3 行だけにして、料金の札を読んだ直後に判断できるようにする。 */
const trialSteps = [
  ["加入のときにカードを登録", "初月の料金はかかりません。"],
  ["2か月目から自動で請求", "終了の3日前と1日前にメールでお知らせします。"],
  ["無料期間中の解約は請求なし", "解約しても、無料期間の終わりまでは使えます。"],
];

function endsAtLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function ServicePage() {
  const now = new Date();
  const quotes = quoteAll(await loadActiveCampaigns(now), now);
  const plans = buildServicePlans(quotes);
  // 初月無料と価格キャンペーンは併用しない。月額のキャンペーンは再加入者にだけ効くので、
  // 単発の期限と分けて書く（「2か月無料」と読ませない）。
  const oneTimeCampaignDeadline = endsAtLabel(quotes.oneTime.campaignEndsAt);
  const subscriptionCampaignDeadline = endsAtLabel(
    quotes.subscriptionUnlimited.campaignEndsAt ?? quotes.subscription8.campaignEndsAt,
  );

  return (
    <div className="stack">
      <PageHeader
        eyebrow="料金"
        title="作るほど高くならない。公開した回数だけ。"
        lead="チラシと告知ページの作成、出欠の集計、名簿、集金の記録までが同じ料金に含まれます。 参加者が払うのは、イベントの参加費だけです。"
      />

      <ul className="plan-list">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </ul>

      {(oneTimeCampaignDeadline || subscriptionCampaignDeadline) && (
        <Alert tone="info">
          {oneTimeCampaignDeadline && (
            <>単発チケットは {oneTimeCampaignDeadline} までの価格キャンペーンを実施中です。</>
          )}
          {subscriptionCampaignDeadline && (
            <>
              月額の価格キャンペーンは、初月無料を使えない再加入者に適用します。初月無料とは併用しません。
            </>
          )}
        </Alert>
      )}

      <Section>
        <SectionHead title="料金に含まれるもの" note="あとから追加課金になる機能はありません。" />
        <Rows>
          {capabilities.map(([title, body]) => (
            <Row
              title={<>{title}</>}
              meta={<>{body}</>}
              aside={<><span className="rows__value">含む</span></>}
              key={title}
            />
          ))}
        </Rows>
      </Section>

      {/* 初月無料の条件。値段の札から FAQ へ移る前に、1 度だけ読ませる。 */}
      <Section>
        <SectionHead title="初月無料のしくみ" note="はじめての月額プラン加入だけが対象です。" />
        <ol className="step-list">
          {trialSteps.map(([title, body]) => (
            <li key={title} className="step-row">
              <h3 className="step-row__title">{title}</h3>
              <p className="step-row__body">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionHead title="よくある質問" />
        <div className="fold-list">
          {faqs.map(([question, answer]) => (
            <details key={question} className="fold">
              <summary className="fold__summary">{question}</summary>
              <div className="fold__body">
                <p>{answer}</p>
              </div>
            </details>
          ))}
        </div>
      </Section>

      <div className="panel__actions">
        <Link href={SITE.nav.createEvent.href} className="btn btn--primary">
          {SITE.cta.createEventFree}
        </Link>
        <Link href={SITE.nav.organizerLogin.href} className="btn btn--outline">
          {SITE.nav.organizerLogin.label}
        </Link>
      </div>

      <p className="screen-note">
        月額の解約とカードの変更は、加入したあと主催一覧から行います。このページでは支払いは始まりません。枠が足りなくなったとき、作成画面で単発・月額で8件まで公開プラン・公開し放題から選びます。
        初月無料は、はじめての月額プラン加入だけが対象です。2か月目から定価を自動で請求し、終了の3日前と1日前にメールでお知らせします。詳しい条件は
        <Link href={SITE.nav.terms.href} className="text-link">
          {SITE.nav.terms.label}
        </Link>
        に記載しています。
      </p>
    </div>
  );
}
