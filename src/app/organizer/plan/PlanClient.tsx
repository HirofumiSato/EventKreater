"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Loading,
  PageHeader,
  Panel,
  PanelHead,
  PlanCard,
  Row,
  Rows,
} from "@/components/ui";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { StripePortalButton } from "@/modules/billing/components/StripePortalButton";
import { TicketPurchaseModal } from "@/modules/billing/components/TicketPurchaseModal";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { buildServicePlans, SERVICE_PLANS, type ServicePlan } from "@/modules/billing/lib/plans";
import type { QuotaSeed } from "@/modules/events/types";
import { formatDateTimeMinuteJa } from "@/lib/format";
import { SITE } from "@/lib/site";

/** 新規に申し込める月額プラン。DB の SubscriptionPlan から NONE を除いた形。 */
type SubscriptionChoice = "MONTHLY_8" | "UNLIMITED";

/**
 * プランとカードの管理（SCR-ORG-17）。
 *
 * 契約の状態・残数・選べるプランを 1 画面にまとめる。カードの変更と解約だけは
 * Stripe の Customer Portal が受けるので、この画面から開く。加入中は新規申込を
 * 出さない（API は 409 を返す）ため、変更は Portal へ案内する。
 *
 * 残数と価格はサーバーで読んだ `initialQuota` から始める。この画面の内容は
 * すべてクォータから決まるので、ハイドレーション後に取り直さない。
 */
export function PlanClient({ initialQuota }: { initialQuota: QuotaSeed }) {
  // 決済から戻った `session_id` を読むため、`useSearchParams` を使う層は Suspense で包む。
  return (
    <Suspense
      fallback={
        <Loading>
          読み込んでいます
        </Loading>
      }
    >
      <OrganizerPlanScreen initialQuota={initialQuota} />
    </Suspense>
  );
}

function OrganizerPlanScreen({ initialQuota }: { initialQuota: QuotaSeed }) {
  const quotaState = useEventQuota(initialQuota);
  const { quota, isLoading, refreshQuota, startSubscriptionCheckout } = quotaState;
  const [ticketOpen, setTicketOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<SubscriptionChoice | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);

  const status = quota?.subscriptionStatus ?? "NONE";
  const subscribed = status === "ACTIVE" || status === "PAST_DUE";
  // 付与（運営付与・デモ）の公開し放題。Stripe の契約ではないので、申込・支払い・解約の導線は出さない。
  const granted = quota?.grantedUnlimited === true;

  // 付与は種別で括弧だけを変える（運営付与とデモで中身は同じ）。
  const currentPlanLabel = granted
    ? quota?.grantedKind === "DEMO"
      ? "公開し放題プラン（デモ）"
      : "公開し放題プラン（運営付与）"
    : status !== "ACTIVE"
      ? "月額プランなし"
      : quota?.subscriptionPlan === "UNLIMITED"
        ? "公開し放題プラン"
        : "8件まで公開プラン";

  const publishedCount = quota?.publishedEventCount ?? 0;
  const publishedLimit = quota?.publishedEventLimit ?? null;
  // API は未加入にも上限（8）を返すので、公開し放題プランを先に見る。
  const publishedValue =
    granted || (subscribed && quota?.subscriptionPlan === "UNLIMITED")
      ? `${publishedCount} 件（上限なし）`
      : publishedLimit
        ? `${publishedCount} / ${publishedLimit} 件`
        : `${publishedCount} 件`;

  // 価格は販売中のキャンペーンを反映する。取れていないときは定価の札をそのまま使う。
  const plans: readonly ServicePlan[] = quota?.pricing
    ? buildServicePlans(quota.pricing)
    : SERVICE_PLANS;
  const monthlyPlans = plans
    .filter((plan) => plan.id === "subscription-8" || plan.id === "subscription-unlimited")
    // 初月無料は対象者だけに出す。対象外は 0 か月にして、価格キャンペーンを見せる。
    .map((plan) => (quota?.trialEligible === true ? plan : { ...plan, trialMonths: 0 }));
  const singlePlan =
    plans.find((plan) => plan.id === "single") ??
    SERVICE_PLANS.find((plan) => plan.id === "single");

  // 支払いに問題があるあいだは、単発チケットを勧めない。公開し放題プランと付与は足す必要がない。
  const ticketHidden = status === "PAST_DUE" || granted || (status === "ACTIVE" && quota?.subscriptionPlan === "UNLIMITED");
  const grantUsed =
    quota?.pricing?.oneTime.chargedPrice === 0 && (quota?.freeGrantRemaining ?? 0) === 0;

  const beginSubscription = async (plan: SubscriptionChoice) => {
    setPendingPlan(plan);
    setCheckoutError(null);
    try {
      await startSubscriptionCheckout(plan, { returnTo: "/organizer/plan" });
    } catch (cause) {
      setCheckoutError(
        cause instanceof Error ? cause.message : "プランの手続きを始められませんでした。",
      );
    } finally {
      setPendingPlan(null);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="プラン・カード管理"
        lead="いまのプランとチケットを確認できます。"
        actions={<Link href={SITE.nav.organizerList.href} className="btn btn--outline btn--sm">
            {SITE.nav.organizerList.label}へ
          </Link>}
      />

      <VerifyPaymentBanner onVerified={() => void refreshQuota()} />

      {isLoading && !quota && <Loading>読み込んでいます</Loading>}

      {!isLoading && !quota && (
        <Alert tone="warning">
          プランとチケットを読み込めませんでした。
          <Link href={SITE.nav.organizerLogin.href} className="text-link">
            ログイン
          </Link>
          してください。
        </Alert>
      )}

      {quota && (
        <>
          {status === "PAST_DUE" && (
            <Alert tone="warning">お支払いに問題があります。カードを更新してください。</Alert>
          )}
          {portalError && <Alert tone="error">{portalError}</Alert>}

          <Panel>
            <PanelHead title="いまのプラン" />
            <Rows>
              <Row
                title="プラン"
                aside={
                  <Badge tone={status === "ACTIVE" || granted ? "success" : "neutral"}>
                    {currentPlanLabel}
                  </Badge>
                }
              />
              <Row
                title="公開中のイベント"
                aside={<span className="rows__value">{publishedValue}</span>}
              />
              <Row
                title="無料チケット"
                aside={<span className="rows__value">{quota.remainingFree} 枚</span>}
              />
              {quota.paidCredits > 0 && (
                <Row
                  title="単発チケット"
                  aside={<span className="rows__value">{quota.paidCredits} 枚</span>}
                />
              )}
              {quota.tickets && quota.tickets.available > 0 && (
                <Row
                  title="期限つきチケット"
                  meta={
                    quota.tickets.expiringAt
                      ? `${formatDateTimeMinuteJa(quota.tickets.expiringAt)} まで`
                      : undefined
                  }
                  aside={<span className="rows__value">{quota.tickets.available} 枚</span>}
                />
              )}
              {(quota.freeGrantRemaining ?? 0) > 0 && (
                <Row
                  title="0円チケット"
                  aside={<span className="rows__value">あと {quota.freeGrantRemaining} 枚</span>}
                />
              )}
              {quota.trial && (
                <Row
                  title="初月無料"
                  aside={
                    <span className="rows__value">
                      {formatDateTimeMinuteJa(quota.trial.endsAt)} まで
                    </span>
                  }
                />
              )}
              {quota.discount && (
                <Row
                  title="割引"
                  meta={`${formatDateTimeMinuteJa(quota.discount.endsAt)} まで`}
                  aside={<span className="rows__value">{quota.discount.percent}%割引</span>}
                />
              )}
              {/* 付与は Stripe の契約ではないので、次回更新は無い。 */}
              {!granted && quota.currentPeriodEnd && (
                <Row
                  title="次回更新"
                  aside={
                    <span className="rows__value">
                      {formatDateTimeMinuteJa(quota.currentPeriodEnd)}
                    </span>
                  }
                />
              )}
            </Rows>
          </Panel>

          {!granted && status !== "NONE" && (
            <Panel>
              <PanelHead title="お支払いと解約" />
              <StripePortalButton
                label="カードを変更・解約"
                className="btn btn--outline btn--block"
                onError={(message) => setPortalError(message)}
              />
              <p className="help">カードの変更と解約は Stripe の画面で行います。</p>
            </Panel>
          )}

          {/* 付与は買う対象が無いので、月額プランと単発チケットの節を出さない。 */}
          {!granted && (
            <Panel>
              <PanelHead title="月額プラン" note="公開中のイベント数を増やせます。" />
              {checkoutError && <Alert tone="error">{checkoutError}</Alert>}
              <ul className="plan-list plan-list--pair">
                {monthlyPlans.map((plan) => {
                  const choice: SubscriptionChoice =
                    plan.id === "subscription-unlimited" ? "UNLIMITED" : "MONTHLY_8";
                  const quote =
                    choice === "UNLIMITED"
                      ? quota.pricing?.subscriptionUnlimited
                      : quota.pricing?.subscription8;
                  const label =
                    quota.trialEligible === true
                      ? "初月0円で始める"
                      : quote?.chargedPrice === 0
                        ? "0円で定期購入を始める"
                        : "このプランを始める";
                  return (
                    <PlanCard key={plan.id} plan={plan}>
                      {subscribed ? (
                        <p className="help">
                          加入中のプランを変えるときは「カードを変更・解約」から手続きしてください。
                        </p>
                      ) : (
                        <button
                          type="button"
                          className={
                            plan.recommended
                              ? "btn btn--primary btn--block"
                              : "btn btn--outline btn--block"
                          }
                          onClick={() => void beginSubscription(choice)}
                          disabled={pendingPlan !== null}
                        >
                          {pendingPlan === choice ? "接続しています…" : label}
                        </button>
                      )}
                    </PlanCard>
                  );
                })}
              </ul>
            </Panel>
          )}

          {!ticketHidden && singlePlan && (
            <Panel>
              <PanelHead title="単発チケット" note="必要なときだけ1枚足せます。" />
              <ul className="plan-list plan-list--pair">
                <PlanCard plan={singlePlan}>
                  <button
                    type="button"
                    className="btn btn--outline btn--block"
                    onClick={() => setTicketOpen(true)}
                    disabled={grantUsed}
                  >
                    {grantUsed ? "受け取り済みです" : "単発チケットを買う"}
                  </button>
                </PlanCard>
              </ul>
            </Panel>
          )}

          {!granted && (
            <p className="help">
              初月無料の終了後は、登録したカードへ自動で請求します。3日前と1日前にメールでお知らせします。詳しくは
              <Link href={SITE.nav.terms.href} className="text-link">
                {SITE.nav.terms.label}
              </Link>
              をご確認ください。
            </p>
          )}
        </>
      )}

      <TicketPurchaseModal
        isOpen={ticketOpen}
        onClose={() => setTicketOpen(false)}
        quota={quotaState.quota}
        onPurchase={() => quotaState.startOneTimeCheckout({ returnTo: "/organizer/plan" })}
        onGranted={() => void quotaState.refreshQuota()}
      />
    </div>
  );
}
