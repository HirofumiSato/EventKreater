import Link from "next/link";
import { buildServicePlans } from "@/modules/billing/lib/plans";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteBoth } from "@/modules/billing/lib/pricing";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";

const capabilities = [
  ["チラシから告知", "開催情報から縦長のチラシを作り、告知ページの先頭に載せます。"],
  ["名前と出欠だけ", "参加者はメールもパスワードも不要です。同じブラウザなら、次回から自分の回答を表示します。"],
  ["参加者へリマインド", "開催が近づいたら、名簿から参加者へ案内を送れます。会員にはメールで届き、アカウントのない参加者には文面をコピーして LINE や DM に貼れます。"],
  ["見込みの売上", "費用プランと出欠から、見込みの売上を自動で計算します。領収書の発行額と並べて、集金の前に確かめられます。会員登録した幹事から使えます。"],
  ["幹事を分けられる", "共同幹事を招待して編集を分けられます。利用枠を消費するのは、イベントを公開した筆頭幹事です。"],
];

function priceLabel(priceYen: number): string {
  if (priceYen === 0) return "0円";
  return `¥${priceYen.toLocaleString("ja-JP")}`;
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
      <section className="hero">
        <p className="hero__eyebrow">{SITE.nav.service.label}</p>
        <h1 className="hero__title">告知ページと出欠を、必要な分だけ。</h1>
        <p className="hero__lead">
          チラシを作り、出欠を集めます。利用枠を支払うのは、イベントを公開する幹事です。参加者の出欠は無料です。
        </p>
        <div className="hero__actions">
          <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--lg">
            {SITE.nav.createEvent.label}
          </Link>
          <Link href={SITE.nav.organizerLogin.href} className="btn btn--outline btn--lg">
            {SITE.nav.organizerLogin.label}
          </Link>
        </div>
      </section>

      <section>
        <h2 className="panel__title">できること</h2>
        <div className="card-grid" style={{ marginTop: "1rem" }}>
          {capabilities.map(([title, body]) => (
            <article key={title} className="card">
              <h3 className="card__title">{title}</h3>
              <p className="card__body">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="panel__title">料金</h2>
        <p className="page-lead">イベントを公開する回数に応じて、次の3つから使います。</p>
        {campaignDeadline && (
          <p className="alert alert--info" style={{ marginTop: "1rem" }}>
            期間限定の価格キャンペーンを実施中です。表示中の金額は {campaignDeadline} までの販売価格です。
            0円の月額プランは、無料期間の終了後に月額料金へ自動で切り替わります。
          </p>
        )}
        <div className="card-grid" style={{ marginTop: "1rem" }}>
          {plans.map((plan) => (
            <article key={plan.id} className="card">
              <h3 className="card__title">{plan.name}</h3>
              {plan.discountPercent > 0 && (
                <p className="eyebrow" style={{ color: "var(--color-primary-text)" }}>
                  {plan.discountPercent >= 100 ? "全額無料" : `${plan.discountPercent}%OFF`}
                  {plan.campaignName ? ` ・ ${plan.campaignName}` : ""}
                </p>
              )}
              <p className="stat__value">
                {priceLabel(plan.priceYen)}
                {plan.discountPercent > 0 && plan.listPriceYen !== plan.priceYen && (
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      fontSize: "1rem",
                      color: "var(--color-text-faint)",
                      textDecoration: "line-through",
                    }}
                  >
                    {priceLabel(plan.listPriceYen)}
                  </span>
                )}
              </p>
              <p className="card__body">
                {plan.unit}。{plan.body}
              </p>
              {plan.campaignEndsAt && plan.discountPercent > 0 && (
                <p className="help">{endsAtLabel(plan.campaignEndsAt)} までの販売価格です。</p>
              )}
            </article>
          ))}
        </div>
        <p className="help" style={{ marginTop: "1rem" }}>
          月額の解約とカードの変更は、加入したあと主催一覧から行います。このページでは支払いは始まりません。枠が足りなくなったとき、作成画面で単発か月額を選びます。
        </p>
        <p className="help" style={{ marginTop: "0.5rem" }}>
          0円の月額プランは、無料期間の終了後に自動で有料へ切り替わります。終了の3日前と1日前にメールでお知らせします。詳しい条件は
          <Link href="/terms" className="text-link">
            利用規約
          </Link>
          に記載しています。
        </p>
      </section>
    </div>
  );
}
