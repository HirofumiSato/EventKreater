import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { PageHeader, Panel } from "@/components/ui";

export const metadata: Metadata = {
  title: `プライバシーポリシー | ${SITE.name}`,
  description: "取得する情報、利用目的、委託先、保管期間、開示・訂正・削除の請求方法を定めます。",
};

const UPDATED_AT = "2026年11月7日";

/*
 * 外部送信の一覧。利用規約 第15条（GA4）と食い違わせないため、
 * 送信先と送る情報をここでも同じ並びで書く。
 * 委託先を増やしたときは、この配列と条文の両方を直す。
 */
const processors: ReadonlyArray<[string, string]> = [
  ["Stripe, Inc.", "決済。カード情報、氏名、メールアドレス、請求金額"],
  ["Resend（Cloudflare Worker 経由）", "確認メールと無料期間の終了前のお知らせ。宛先と本文"],
  ["Twilio（Cloudflare Worker 経由）", "電話番号の確認コードの SMS。宛先と本文"],
  ["OpenAI, L.L.C.", "チラシの生成と音声の文字起こし。入力した催しの情報と音声"],
  ["Google LLC（Google Analytics 4）", "利用状況。Cookie の識別子、閲覧 URL、端末情報、IP アドレス"],
  ["Cloudflare, Inc.", "配信、DNS、メールと SMS の中継。接続元の IP アドレス"],
  ["Fly.io, Inc.", "アプリの実行とファイルの保管"],
  ["Neon, Inc.", "データベースの保管"],
  ["株式会社アイビス（zipcloud）", "郵便番号から住所を引くときの郵便番号"],
];

export default function PrivacyPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="プライバシー"
        title={<>{SITE.name} プライバシーポリシー</>}
        lead={<>本サービスがどの情報を、何のために、どこへ渡すかを定めます。</>}
      />

      <div className="notice">
        <strong>要約</strong>　集めるのは、催しを作って出欠を取るために必要な情報だけです。
        カード番号は保持しません。売買や広告のために第三者へ渡すことはなく、外部サービスには
        処理に必要な範囲だけを渡します。
      </div>

      <section className="legal">
        <h2>1. 取得する情報</h2>
        <ul>
          <li>会員の登録情報: 表示名、メールアドレス、電話番号、パスワードのハッシュ</li>
          <li>催しの情報: 催しの名前、日時、会場、料金、チラシの素材</li>
          <li>出欠の情報: 参加の可否、参加者の名前、自由記入の欄、参加表明や参加要望</li>
          <li>決済の情報: 決済事業者が発行する顧客 ID、請求額、決済の状態</li>
          <li>利用の記録: アクセス日時、IP アドレス、ブラウザと端末の種類、操作の履歴</li>
        </ul>
      </section>

      <section className="legal">
        <h2>2. 利用目的</h2>
        <ul>
          <li>催しの告知ページとチラシを作り、参加者へ届けるため</li>
          <li>出欠を集計し、主催者へ名簿として渡すため</li>
          <li>会員の確認、ログイン、パスワードの再設定のため</li>
          <li>チケットと月額プランの販売、請求、無料期間の終了前のお知らせのため</li>
          <li>不正な利用（アカウントの量産、特典の重複取得）を防ぐため</li>
          <li>障害の調査と、画面の改善のため</li>
        </ul>
      </section>

      <section className="legal">
        <h2>3. 第三者への提供</h2>
        <p>
          法令に基づく場合、人の生命・身体・財産を守るために必要な場合、または利用者の同意がある場合を除き、
          個人情報を第三者へ提供しません。販売や広告のために提供することはありません。
        </p>
        <p>
          催しに参加した人の名前と出欠は、その催しの主催者と共同主催に表示されます。
          これは催しを運営するために必要な共有で、第三者の提供には当たりません。
        </p>
      </section>

      <section className="legal">
        <h2>4. 委託と外部送信</h2>
        <p>本サービスは、処理に必要な範囲で次の外部サービスを利用します。</p>
        <ul>
          {processors.map(([name, purpose]) => (
            <li key={name}>
              <strong>{name}</strong>: {purpose}
            </li>
          ))}
        </ul>
        <p>
          委託先には、契約または各社の規約にもとづいて必要な範囲だけを渡します。
          外国にある事業者へ渡る場合がありますが、いずれも各社の定める保護の仕組みに従います。
        </p>
      </section>

      <section className="legal">
        <h2>5. Cookie と計測</h2>
        <p>
          本サービスは、ログインの保持、出欠の重複回答の防止、表示の設定のために Cookie を使います。
          これらはサービスを動かすために必要です。
        </p>
        <p>
          あわせて、利用状況の把握のため Google Analytics 4 を使います。送る情報と拒否の方法は
          <Link href="/terms" className="text-link">
            {" "}
            利用規約 第15条{" "}
          </Link>
          に定めています。ブラウザの Cookie を無効にするか、Google アナリティクス オプトアウト
          アドオンで拒否できます。拒否しても機能は変わりません。
        </p>
      </section>

      <section className="legal">
        <h2>6. 保管期間</h2>
        <p>
          会員の情報は、退会したあとも、決済の記録と不正防止のために必要な期間だけ保管します。
          催しと出欠の情報は、主催者が削除するか、催しの終了から一定の期間が過ぎたあとに削除します。
          決済の記録は、法令と決済事業者の定めに従う期間だけ保管します。
        </p>
      </section>

      <section className="legal">
        <h2>7. 開示・訂正・削除の請求</h2>
        <p>
          ご本人から、保有する個人情報の開示、訂正、追加、削除、利用の停止を求められたときは、
          ご本人であることを確認したうえで、法令に従って対応します。
        </p>
        <p>
          窓口は{" "}
          <a href={`mailto:${SITE.legal.supportEmail}`} className="text-link">
            {SITE.legal.supportEmail}
          </a>
          {" "}です。ご連絡から{SITE.legal.disclosureLeadTime}にご回答します。
        </p>
        <p>
          表示名、メールアドレス、電話番号、パスワードは、
          <Link href="/account" className="text-link">
            {" "}
            アカウント{" "}
          </Link>
          の画面からご自身で変更できます。
        </p>
      </section>

      <section className="legal">
        <h2>8. 安全管理</h2>
        <p>
          通信は HTTPS で暗号化します。パスワードはハッシュにして保存し、平文では保持しません。
          カード番号は決済事業者が管理し、当方のサーバを経由しません。
        </p>
      </section>

      <section className="legal">
        <h2>9. 本ポリシーの変更</h2>
        <p>
          必要に応じて本ポリシーを変更します。重要な変更は、適用開始日の前に本サービス上でお知らせします。
        </p>
      </section>

      <section className="legal">
        <h2>10. 運営者</h2>
        <p>
          {SITE.name}。個人情報保護管理者は運営者の代表者です。氏名と所在地は、ご請求があった場合に
          遅滞なく開示します。ご連絡から{SITE.legal.disclosureLeadTime}にご回答します。
          連絡先は{" "}
          <a href={`mailto:${SITE.legal.supportEmail}`} className="text-link">
            {SITE.legal.supportEmail}
          </a>
          {" "}です。
        </p>
      </section>

      <Panel>
        <p className="help">
          <Link href="/terms" className="text-link">
            利用規約
          </Link>
          {" ・ "}
          <Link href="/tokushoho" className="text-link">
            特定商取引法に基づく表記
          </Link>
        </p>
      </Panel>

      <p className="screen-note">最終改定日 {UPDATED_AT}</p>
    </div>
  );
}
