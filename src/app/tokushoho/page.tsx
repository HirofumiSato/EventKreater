import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { yen } from "@/lib/format";
import { SITE } from "@/lib/site";
import {
  FREE_EVENT_LIMIT,
  ONE_TIME_PRICE_JPY,
  SUBSCRIPTION_8_PRICE_JPY,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  SUBSCRIPTION_UNLIMITED_PRICE_JPY,
} from "@/modules/billing/lib/plans";
import { PageHeader, Panel, PanelHead, Row, Rows } from "@/components/ui";

export const metadata: Metadata = {
  title: `特定商取引法に基づく表記 | ${SITE.name}`,
  description: "販売事業者、販売価格、支払方法、引渡時期、返品と解約の条件を定めます。",
};

const UPDATED_AT = "2026年11月7日";

/*
 * 個人事業主としての表示。法人テンプレートの「代表取締役」「資本金」は置かない。
 * 「運営統括責任者」も特定商取引法の法定記載事項ではないため、項目ごと持たない。
 * 販売事業者名は屋号だけを出し、氏名・住所・電話番号は開示請求方式にする
 * （氏名は公開しない。請求があったときだけメールで答える）。
 * 金額は plans.ts の定数から引く（値上げのときに 1 か所で済むようにする）。
 */
const rows: ReadonlyArray<{ title: string; body: ReactNode }> = [
  { title: "販売事業者名", body: `${SITE.name}（屋号）` },
  { title: "所在地", body: SITE.legal.onRequestDisclosure },
  { title: "電話番号", body: SITE.legal.onRequestDisclosure },
  {
    title: "メールアドレス",
    body: (
      <a href={`mailto:${SITE.legal.supportEmail}`} className="text-link">
        {SITE.legal.supportEmail}
      </a>
    ),
  },
  {
    title: "販売価格",
    body: (
      <>
        単発チケット {yen(ONE_TIME_PRICE_JPY)}（1 枚）、
        {SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件まで公開プラン {yen(SUBSCRIPTION_8_PRICE_JPY)}（月額）、
        公開し放題プラン {yen(SUBSCRIPTION_UNLIMITED_PRICE_JPY)}（月額）。
        いずれも消費税込みです。無料チケットは、イベントの公開を累計 {FREE_EVENT_LIMIT} 枚まで無料で使えます。
      </>
    ),
  },
  {
    title: "商品代金以外の必要料金",
    body: "ありません。通信に要する費用は利用者の負担です。",
  },
  {
    title: "支払方法",
    body: "クレジットカード（Stripe, Inc. を通じた決済）。カード番号は当方では保持しません。",
  },
  {
    title: "支払時期",
    body:
      "単発チケットは購入時、月額プランは加入時と毎月の更新時に自動で決済します。" +
      "請求日は加入日を基準とし、日割りでの精算は行いません。",
  },
  {
    title: "引渡時期",
    body: "決済の完了後、直ちに利用できます。",
  },
  {
    title: "返品・解約",
    body:
      "サービスの性質上、購入後の返品は受け付けません。" +
      "月額プランは「プラン・カード管理」からいつでも解約でき、次の更新で止まります。" +
      "無料期間中に解約した場合は請求しません。すでに経過した月額料金の日割りでの返金はしません。",
  },
  {
    title: "動作環境",
    body: "最新版の Google Chrome・Safari・Microsoft Edge（スマートフォンを含みます）。",
  },
];

export default function TokushohoPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="特定商取引法"
        title={<>特定商取引法に基づく表記</>}
        lead={<>本サービスは個人事業として運営しています。価格、支払い、引渡し、返品と解約の条件は次のとおりです。</>}
      />

      <Panel>
        <PanelHead
          title="販売条件"
          note="表示価格はすべて消費税込みです。"
        />
        <Rows>
          {rows.map(({ title, body }) => (
            <Row key={title} title={title} meta={body} />
          ))}
        </Rows>
      </Panel>

      <Panel className="legal">
        <h2>開示請求について</h2>
        <p>
          氏名、所在地、電話番号は、{SITE.legal.onRequestDisclosure}
        </p>
        <p>ご連絡から{SITE.legal.disclosureLeadTime}にご回答します。</p>
        <p>
          ご請求は
          <a href={`mailto:${SITE.legal.supportEmail}`} className="text-link">
            {" "}
            {SITE.legal.supportEmail}{" "}
          </a>
          までお願いします。
        </p>
        <p>
          解約の方法、返金の条件、料金の詳細は
          <Link href="/terms" className="text-link">
            {" "}
            利用規約{" "}
          </Link>
          に定めています。
        </p>
      </Panel>

      <p className="screen-note">最終改定日 {UPDATED_AT}</p>
    </div>
  );
}
