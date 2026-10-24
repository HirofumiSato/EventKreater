import Link from "next/link";
import { buildServicePlans } from "@/modules/billing/lib/plans";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteBoth } from "@/modules/billing/lib/pricing";
import { SITE } from "@/lib/site";
import { Alert, PageHeader, Row, Rows, Section, SectionHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const capabilities = [
  ["チラシから告知", "開催情報から縦長のチラシを作り、告知ページの先頭に載せます。"],
  ["名前と出欠だけ", "参加者はメールもパスワードも不要です。同じブラウザなら、次回から自分の回答を表示します。"],
  ["参加者へリマインド", "開催が近づいたら、名簿から参加者へ案内を送れます。会員にはメールで届き、アカウントのない参加者には文面をコピーして LINE や DM に貼れます。"],
  ["見込みの売上", "費用プランと出欠から、見込みの売上を自動で計算します。領収書の発行額と並べて、集金の前に確かめられます。会員登録した幹事から使えます。"],
  ["主催者と共同主催", "主催者と共同主催者を分けて、告知ページに名前を出します。招待された共同主催者は編集と名簿を分担でき、利用枠を消費するのはイベントを公開した主催者だけです。"],
  ["催しの日程をカレンダーで見る", "自分が幹事の催しを月表示で並べます。開催日が複数ある催しも、すべての日付で出ます。日付を選ぶと、その日の出欠確認へ進めます。"],
];

/* よくある質問。条文の正は /terms。ここは要約だけを置き、重複した詳細は書かない。 */
const faqs = [
  [
    "参加者からは料金を取りますか",
    "取りません。参加者が答えるのは出欠だけで、参加費は催しの主催者へ直接お支払いください。",
  ],
  [
    "途中で解約できますか",
    "月額はいつでも解約できます。解約しても、次の更新までは使えます。日割りの返金はしません。",
  ],
  [
    "キャンペーン価格は、あとから変わりますか",
    "すでに購入した回の金額は変わりません。実施中のキャンペーンは、購入前に販売価格と定価を並べて表示します。",
  ],
];

function priceLabel(priceYen: number): string {
  if (priceYen === 0) return "0";
  return `${priceYen.toLocaleString("ja-JP")}`;
}

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
  const quotes = quoteBoth(await loadActiveCampaigns(now), now);
  const plans = buildServicePlans(quotes);
  const campaignDeadline = endsAtLabel(quotes.subscription.campaignEndsAt ?? quotes.oneTime.campaignEndsAt);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="料金"
        title="作るほど高くならない。公開した回数だけ。"
        lead="チラシと告知ページの作成、出欠の集計、名簿、領収書までが同じ料金に含まれます。 参加者が払うのは、催しの参加費だけです。"
      />

      <ul className="plan-list">
        {plans.map((plan) => (
          <li key={plan.id} className={`plan-card${plan.recommended ? " plan-card--pick" : ""}`}>
            <p className="plan-card__name">{plan.name}</p>
            {plan.discountPercent > 0 && (
              <p className="plan-card__badge">
                {plan.discountPercent >= 100 ? "全額無料" : `${plan.discountPercent}%OFF`}
                {plan.campaignName ? ` ・ ${plan.campaignName}` : ""}
              </p>
            )}
            <p className="plan-card__price">
              {priceLabel(plan.priceYen)}
              <small>円 / {plan.unit}</small>
              {plan.discountPercent > 0 && plan.listPriceYen !== plan.priceYen && (
                <s className="plan-card__list-price">定価 {priceLabel(plan.listPriceYen)}円</s>
              )}
            </p>
            <p className="screen-note">{plan.body}</p>
            <ul className="plan-card__list">
              {plan.highlights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {plan.campaignEndsAt && plan.discountPercent > 0 && (
              <p className="help">{endsAtLabel(plan.campaignEndsAt)} までの販売価格です。</p>
            )}
          </li>
        ))}
      </ul>

      {campaignDeadline && (
        <Alert tone="info">
          期間限定の価格キャンペーンを実施中です。表示中の金額は {campaignDeadline} までの販売価格です。
          0円の月額プランは、無料期間の終了後に月額料金へ自動で切り替わります。
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
        月額の解約とカードの変更は、加入したあと主催一覧から行います。このページでは支払いは始まりません。枠が足りなくなったとき、作成画面で単発か月額を選びます。
        0円の月額プランは、無料期間の終了後に自動で有料へ切り替わります。終了の3日前と1日前にメールでお知らせします。詳しい条件は
        <Link href={SITE.nav.terms.href} className="text-link">
          {SITE.nav.terms.label}
        </Link>
        に記載しています。
      </p>
    </div>
  );
}
