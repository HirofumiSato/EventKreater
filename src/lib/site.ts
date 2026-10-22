/**
 * サイト表示の定数テーブル。
 * 仮置きのサービス名と公開クロムの文言はここだけを変える。
 * ヘッダー、フッター、メタデータ、ホームとサービスページの CTA がこれを読む。
 */
export const SITE = {
  name: "EventKreater",
  tagline: "案内は、チラシ1枚。出欠は、名前だけ。",
  description:
    "催し名・日時・場所を入れるだけで、告知ページとチラシができます。参加者は登録なしで出欠を答えられ、集計は自動で揃います。",
  nav: {
    home: { href: "/", label: "トップ" },
    service: { href: "/service", label: "サービスと料金" },
    createEvent: { href: "/organizer/events/new", label: "イベントを作る" },
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
    participantSwitch: { href: "/participant", label: "参加者として見る" },
  },
} as const;
