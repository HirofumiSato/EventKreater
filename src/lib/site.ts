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
 * ホームの h1。スマホの 390px でも折り返しが意図どおりになるよう、行ごとに分けて持つ。
 * 各要素の末尾に読点・句点を置き、つなげて 1 行にしても文として通るようにしてある。
 * スマホは 3 行、PC（1024px 以上）は 1・2 行目をつなげて 2 行にする（`components.css`）。
 */
const TAGLINE_LINES = ["イベントのチラシと", "WEBページ、", "5分で簡単作成。"] as const;

export const SITE = {
  name: "EventKreater",
  // ホームの h1。何をどれだけの時間で作れるかを、最初の 1 文で言い切る。
  // 画面では行ごとに改行して出し、1 行で扱う場所は `tagline` を使う。
  taglineLines: TAGLINE_LINES,
  tagline: TAGLINE_LINES.join(""),
  description:
    "催し名・日時・場所を入れるだけで、チラシと告知ページが5分でできます。参加者は登録なしで出欠を答えられ、集計は自動で揃います。",
  nav: {
    home: { href: "/", label: "トップ" },
    service: { href: "/service", label: "サービスと料金" },
    createEvent: CREATE_EVENT,
    organizerList: { href: "/organizer/events", label: "主催一覧" },
    organizerLogin: { href: "/auth/register", label: "主催者ログイン" },
    participantLogin: { href: "/participant/login", label: "参加者ログイン" },
    participantHome: { href: "/participant", label: "参加者ホーム" },
    participantCalendar: { href: "/participant/calendar", label: "参加カレンダー" },
    participantHistory: { href: "/participant/history", label: "参加履歴" },
    mypage: { href: "/mypage", label: "主催者マイページ" },
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
    /** ホームなどの主操作。ナビのラベルに「無料で」を足しただけ。 */
    createEventFree: `無料で${CREATE_EVENT.label}`,
    /** 主催イベントが 0 件のときの空状態。 */
    createEventFirst: `最初の${CREATE_EVENT.label}`,
  },
} as const;
