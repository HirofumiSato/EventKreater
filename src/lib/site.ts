/**
 * サイト表示の定数テーブル。
 * 仮置きのサービス名と公開クロムの文言はここだけを変える。
 * ヘッダー、フッター、メタデータ、ホームとサービスページの CTA がこれを読む。
 */

/**
 * イベント作成画面への入口。このラベルを変えると、ヘッダー・フッター・
 * 各画面の CTA・空状態の案内がまとめて変わる。直書きしない。
 */
const CREATE_EVENT = { href: "/organizer/events/new", label: "イベント告知ページを作る" } as const;

/**
 * ホームの h1。スマホの 360px でも折り返しが意図どおりになるよう、句ごとに分けて持つ。
 * 各要素の末尾に読点・句点を置き、つなげて 1 行にしても文として通るようにしてある。
 * 画面では 1 つ目は折らずに 1 行に置き、2 つ目からを横に並べる（どの幅も同じ並び）。
 * 文字サイズは見出し全体で 1 つにする。いちばん長いのは
 * 2 つ目と 3 つ目を並べた 15 文字で、折り返さない大きさを `components.css` が幅ごとに持つ。
 * 吹き出しは最後の段に添える。
 */
const TAGLINE_LINES = [
  "イベント告知&申込のウェブページ、",
  "5分で簡単作成。",
  "スマホで完結。",
] as const;

export const SITE = {
  name: "EventKreater",
  // ホームの h1。何をどれだけの時間で作れるかを、最初の 1 文で言い切る。
  // 画面では行ごとに改行して出し、1 行で扱う場所は `tagline` を使う。
  taglineLines: TAGLINE_LINES,
  tagline: TAGLINE_LINES.join(""),
  description:
    "イベント名・日時・場所・料金を入れるだけで、チラシと告知ページが5分でできます。URLを送るだけで集客と予約管理が完結し、出欠の集計も自動です。",
  nav: {
    home: { href: "/", label: "トップ" },
    service: { href: "/service", label: "サービスと料金" },
    /**
     * 作った告知ページの見本（SCR-PUB-16）。初見の主催者が「自分の催しならどう見えるか」を
     * 作る前に確かめる入口である。DB を使わない静的な画面へ送る。
     */
    sample: { href: "/sample", label: "サンプルを見る" },
    createEvent: CREATE_EVENT,
    organizerList: { href: "/organizer/events", label: "主催一覧" },
    organizerLogin: { href: "/auth/register", label: "主催者ログイン" },
    participantLogin: { href: "/participant/login", label: "参加者ログイン" },
    participantHome: { href: "/participant", label: "参加者ホーム" },
    participantCalendar: { href: "/participant/calendar", label: "参加カレンダー" },
    participantHistory: { href: "/participant/history", label: "参加履歴" },
    mypage: { href: "/mypage", label: "主催者マイページ" },
    /**
     * 主催者画面の節（`OrganizerTabs`）の先頭。同じ `/mypage` でも、
     * 参加者画面のバーでは「主催者マイページ」、主催者の節では「ホーム」と呼ぶ。
     * 並びの違う面で同じ文言にすると、どちらのエリアの入口か読めなくなる。
     */
    organizerHome: { href: "/mypage", label: "ホーム" },
    /** 下書き（SCR-ORG-15）。主催者の節からは外し、頭文字のメニューが受ける。 */
    organizerDrafts: { href: "/organizer/events/drafts", label: "下書き" },
    /**
     * 主催者の新着（参加表明・参加要望・紹介でのチケット付与）。全件は通知一覧（SCR-PUB-15）が受け、
     * マイページの「新着」は 4 件までに留める。
     */
    notifications: { href: "/notifications", label: "通知" },
    /**
     * プランとカードの管理（SCR-ORG-17）。契約の状態・残数・選べるプランを 1 画面にまとめ、
     * Stripe の Portal（カードの変更・解約）はその画面の中の操作が開く。
     * 入口は主催者として見ているあいだの頭文字のメニューだけが持つ。
     */
    plan: { href: "/organizer/plan", label: "プラン・カード管理" },
    account: { href: "/account", label: "アカウント" },
    terms: { href: "/terms", label: "利用規約" },
    /**
     * 有料販売に要る 2 ページ。フッターだけが持つ（ヘッダーのナビには置かない）。
     * 特商法表記は購入の直前に読まれるので、料金ページからも辿れるようにする。
     */
    privacy: { href: "/privacy", label: "プライバシーポリシー" },
    tokushoho: { href: "/tokushoho", label: "特定商取引法に基づく表記" },
    // ヘッダーの出し分け用。参加者画面と主催者画面の行き来はこの 2 本だけにする。
    organizerSwitch: { href: "/organizer/events", label: "主催者として使う" },
    participantSwitch: { href: "/participant", label: "参加者ログイン" },
    // 管理者だけに出す。公開画面からは辿れない（`/console` は noindex）。
    console: { href: "/console", label: "管理コンソール" },
  },
  // 共通ヘッダーのログイン状態。誰として入っているかを 1 語で示す。
  // 「主催者」は参加者も兼ねる（同じ会員が画面を切り替える）ので、いま見ている画面で決める。
  role: {
    participant: "参加者",
    organizer: "主催者",
    admin: "管理者",
  },
  /**
   * 特商法表記とプライバシーポリシーに出す運営者の情報。
   *
   * 法人ではなく個人事業なので、販売事業者名は屋号（`name`）だけを出す。
   * 本名は個人情報として公開せず、値もここに持たない（定数に置くと、いつか画面へ出る）。
   * 本名・住所・電話番号は開示請求方式にして、請求があったときだけメールで答える。
   * 連絡先は Cloudflare Email Routing で受ける（docs/deploy.rst の「問い合わせの受信」）。
   */
  legal: {
    /** 問い合わせと開示請求の窓口。受信できることを確かめてから公開する。 */
    supportEmail: "support@eventkreater.com",
    /**
     * 氏名・住所・電話番号の欄に出す定型文。
     * 特商法では氏名の省略が認められていないため、この文面で「請求すれば出る」ことを示す。
     */
    onRequestDisclosure:
      "請求があった場合に遅滞なく開示します。開示をご希望のときは、下記のメールアドレスへご連絡ください。",
    /**
     * 開示請求を受けてから答えるまでの上限。運用の約束としてページに出す。
     * 起点は「ご連絡を受けた日」で、各ページの文がそのように読める形にしてある。
     * 個人情報保護法の「遅滞なく」は、通則編ガイドラインが通常 2 週間以内と解している。
     * これ以上に伸ばすと法令違反になるため、2 週間が上限。短くするのは自由。
     * 特商法の「遅滞なく」も同じ幅で読み、両ページでこの 1 つの値を使う。
     */
    disclosureLeadTime: "2週間以内",
  },
  action: {
    logout: "ログアウト",
  },
  // 作成画面への誘導文。ラベル側を変えれば、ここも追随する。
  cta: {
    /**
     * ホームなどの主操作。無料の条件は書かず、動詞 1 つで言い切る。
     * 条件（最初の 2 枚・カード登録なし）は `freeNote` が受ける。ホームの注記は
     * 2026-11-06 に外したので、いまは `/sample` が読む。
     * 世の中の告知 LP と同じく、ボタンは短く、条件は注記で伝える形にする。
     */
    createEventFree: "無料ではじめる",
    /**
     * 主操作の直下に置く条件の注記。ボタンの中に条件を詰めると、
     * 「何枚まで無料か」を押す前に読ませることになり、主操作が重くなる。
     * カードの要否は書かない。0 円で始められることだけを 1 行で伝える。
     * 条件を並べるのではなく、主操作（はじめる）に続く言い方にする。
     * 月額プランの初月無料は、無料チケットとは別の話なので後ろへ回す（30 文字以内）。
     */
    freeNote: "まずは2枚まで無料。月額プランは初月0円。",
    /** 主催イベントが 0 件のときの空状態。 */
    createEventFirst: `最初の${CREATE_EVENT.label}`,
    /**
     * 告知ページの末尾に置く主催者への誘い（`OrganizerInviteCard`）の見出し。
     * ラベルをそのまま繋ぐと「〜を作るをしませんか」になる。誘いの文では動詞が
     * 「作りませんか」に変わるので、ラベルから組み立てず、ここに 1 つだけ持つ。
     */
    organizerInviteTitle: "あなたもイベント告知ページを作りませんか？",
  },
} as const;
