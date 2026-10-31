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
 * ホームの h1。スマホの 360px でも折り返しが意図どおりになるよう、行ごとに分けて持つ。
 * 各要素の末尾に読点・句点を置き、つなげて 1 行にしても文として通るようにしてある。
 * 改行の位置は幅で変えない（どの幅も 3 行）。2 行目が 13 文字で最も長く、
 * 折り返さない文字サイズを `components.css` が幅ごとに持つ。
 */
const TAGLINE_LINES = ["イベントのチラシと", "告知&出欠ウェブページ、", "5分で簡単作成。"] as const;

export const SITE = {
  name: "EventKreater",
  // ホームの h1。何をどれだけの時間で作れるかを、最初の 1 文で言い切る。
  // 画面では行ごとに改行して出し、1 行で扱う場所は `tagline` を使う。
  taglineLines: TAGLINE_LINES,
  tagline: TAGLINE_LINES.join(""),
  description:
    "イベント名・日時・場所を入れるだけで、チラシと告知ページが5分でできます。参加者は登録なしで出欠を答えられ、集計は自動で揃います。",
  nav: {
    home: { href: "/", label: "トップ" },
    service: { href: "/service", label: "サービスと料金" },
    /**
     * 作った告知ページの見本（SCR-PUB-16）。初見の幹事が「自分の催しならどう見えるか」を
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
     * 主催者の新着（参加表明・参加要望）。全件は通知一覧（SCR-PUB-15）が受け、
     * マイページの「新着」は 4 件までに留める。
     */
    notifications: { href: "/notifications", label: "通知" },
    account: { href: "/account", label: "アカウント" },
    terms: { href: "/terms", label: "利用規約" },
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
  action: {
    logout: "ログアウト",
  },
  // 作成画面への誘導文。ラベル側を変えれば、ここも追随する。
  cta: {
    /**
     * ホームなどの主操作。無料の条件は書かず、動詞 1 つで言い切る。
     * 条件（最初の 2 回・カード登録なし）は直下の `freeNote` が受ける。
     * 世の中の告知 LP と同じく、ボタンは短く、条件は注記で伝える形にする。
     */
    createEventFree: "無料ではじめる",
    /**
     * 主操作の直下に置く条件の注記。ボタンの中に条件を詰めると、
     * 「何回まで無料か」を押す前に読ませることになり、主操作が重くなる。
     * カードの要否は書かない。0 円で始められることだけを 1 行で伝える。
     */
    freeNote: "最初の2回は無料。",
    /** 主催イベントが 0 件のときの空状態。 */
    createEventFirst: `最初の${CREATE_EVENT.label}`,
  },
} as const;
