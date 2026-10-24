/*
 * 画面モックの目録。一覧と比較の両方がここを読む。
 * 管理コンソール（/console/**）は対象外。装飾を比べる画面ではないため。
 *
 * scope: "pop"   = 影だけ（導入）
 *        "quiet" = 静かめ（管理）
 */
window.MOCK_GROUPS = [
  { key: "public", title: "公開", note: "誰でも開ける画面。初めて触る人が最初に見る。" },
  { key: "auth", title: "認証・設定", note: "入る前と、入ったあとの手続き。" },
  { key: "participant", title: "参加者", note: "参加する側の画面。催しを思い出すために開く。" },
  { key: "organizer", title: "主催者", note: "運営する側の画面。数字と行を追う。" },
];

window.MOCK_SCREENS = [
  {
    no: "01", group: "public", name: "ホーム", path: "/", file: "mock-home.html", scope: "pop",
    note: "墨地のヒーロー、機能 3行、使い方、朱の帯。第一印象を作る画面。",
  },
  {
    no: "02", group: "public", name: "サービスと料金", path: "/service", file: "mock-service.html", scope: "pop",
    note: "無料 2回、単発 299円、月額 980円。ここから支払いは始めない。",
  },
  {
    no: "03", group: "public", name: "利用規約", path: "/terms", file: "mock-terms.html", scope: "pop",
    note: "料金、キャンペーン、0円の条件、通知、解約と返金。",
  },
  {
    no: "04", group: "public", name: "イベント告知・出欠", path: "/events/[id]", file: "mock-event.html", scope: "pop",
    note: "チラシを先頭に、その下で出欠。参加者が最初に見る画面。",
  },
  {
    no: "05", group: "public", name: "参加費の領収書", path: "/events/[id]/receipt", file: "mock-event-receipt.html", scope: "pop",
    note: "参加者本人の領収書。印刷して渡せる形。",
  },
  {
    no: "06", group: "public", name: "主催者のプロフィール", path: "/organizers/[userId]", file: "mock-organizer-public.html", scope: "pop",
    note: "顔、肩書き、自己紹介、ジャンル、リンク、実績。",
  },
  {
    no: "07", group: "public", name: "主催者の催し", path: "/organizers/[userId]/events", file: "mock-organizer-public-events.html", scope: "pop",
    note: "一覧とカレンダーの切り替え。未ログインでは骨組みをぼかす。",
  },

  {
    no: "08", group: "auth", name: "主催者のログイン・登録", path: "/auth/register", file: "mock-register.html", scope: "pop",
    note: "パスワードと、確認番号の 2 経路。Google も同じ画面。",
  },
  {
    no: "09", group: "auth", name: "メールの確認", path: "/auth/verify", file: "mock-verify.html", scope: "pop",
    note: "確認メールのリンクを開いたあと。次は電話番号の確認。",
  },
  {
    no: "10", group: "auth", name: "参加者ログイン", path: "/participant/login", file: "mock-participant-login.html", scope: "pop",
    note: "電話番号と確認番号だけ。パスワードは要らない。",
  },
  {
    no: "11", group: "auth", name: "共同幹事の招待", path: "/invitations/[code]", file: "mock-invitation.html", scope: "pop",
    note: "できること・できないことを並べ、加わるかどうかを取る。",
  },
  {
    no: "12", group: "auth", name: "アカウント設定", path: "/account", file: "mock-account.html", scope: "pop",
    note: "表示名、メール、電話、パスワード、退会。主催者と参加者で共通。",
  },
  {
    no: "13", group: "auth", name: "メールアドレスの確定", path: "/account/email/verify", file: "mock-account-verify.html", scope: "pop",
    note: "新しいアドレスの確認。成功したら設定へ戻す。",
  },

  {
    no: "14", group: "participant", name: "参加者ホーム", path: "/participant", file: "mock-participant.html", scope: "pop",
    note: "これからの参加、出席と欠席の件数、次の催し、履歴への導線。",
  },
  {
    no: "15", group: "participant", name: "参加カレンダー", path: "/participant/calendar", file: "mock-participant-calendar.html", scope: "pop",
    note: "答えた催しを開催日に置く。出席・要望・欠席を点で分ける。",
  },
  {
    no: "16", group: "participant", name: "参加履歴", path: "/participant/history", file: "mock-participant-history.html", scope: "pop",
    note: "出欠と領収書の一覧。主催している催しは出さない。",
  },

  {
    no: "17", group: "organizer", name: "主催一覧", path: "/organizer/events", file: "mock-organizer.html", scope: "quiet",
    note: "公開中と受付停止だけ。下書きは件数だけを添えて分ける。",
  },
  {
    no: "18", group: "organizer", name: "主催カレンダー", path: "/organizer/calendar", file: "mock-organizer-calendar.html", scope: "quiet",
    note: "月グリッドと、選んだ日の催し。複数の開催日はすべて出す。",
  },
  {
    no: "19", group: "organizer", name: "売上", path: "/organizer/revenue", file: "mock-revenue.html", scope: "quiet",
    note: "見込み・発行額・差額・平均単価。催し別の一覧が続く。",
  },
  {
    no: "20", group: "organizer", name: "売上の内訳", path: "/organizer/events/[id]/revenue", file: "mock-revenue-detail.html", scope: "quiet",
    note: "プラン別と開催回別。プラン未選択の案内を出す。",
  },
  {
    no: "21", group: "organizer", name: "新規イベント作成", path: "/organizer/events/new", file: "mock-create.html", scope: "pop",
    note: "5ステップのアコーディオン。次へで畳まれ、次が開く。",
  },
  {
    no: "22", group: "organizer", name: "イベントの編集", path: "/organizer/events/[id]/edit", file: "mock-edit.html", scope: "quiet",
    note: "排他ロックの残り時間と、共同幹事の一覧・解除。",
  },
  {
    no: "23", group: "organizer", name: "下書き一覧", path: "/organizer/events/drafts", file: "mock-drafts.html", scope: "quiet",
    note: "自分の下書きだけ。プレビュー・編集・削除。",
  },
  {
    no: "24", group: "organizer", name: "下書きのプレビュー", path: "/organizer/events/[id]/preview", file: "mock-preview.html", scope: "quiet",
    note: "告知ページと同じ見た目。出欠フォームは出さない。",
  },
  {
    no: "25", group: "organizer", name: "参加者名簿", path: "/organizer/events/[id]/participants", file: "mock-roster.html", scope: "quiet",
    note: "表。行の軸が揃っていることが機能そのもの。",
  },
  {
    no: "26", group: "organizer", name: "幹事向け領収書", path: "/organizer/events/[id]/receipts/[participantId]", file: "mock-receipt.html", scope: "quiet",
    note: "再発行と印刷。番号は変わらず、発行日だけが進む。",
  },
  {
    no: "27", group: "organizer", name: "公開直後の案内", path: "/organizer/register-required", file: "mock-register-required.html", scope: "quiet",
    note: "共有 URL と、登録後にできること。未登録の幹事にだけ出す。",
  },
  {
    no: "28", group: "organizer", name: "公開プロフィールの編集", path: "/organizer/profile", file: "mock-organizer-profile.html", scope: "quiet",
    note: "公開の可否、肩書き、自己紹介、エリア、ジャンル、SNS。",
  },
  {
    no: "29", group: "organizer", name: "主催者マイページ", path: "/mypage", file: "mock-mypage.html", scope: "quiet",
    note: "直近 3件、利用枠と契約、プロフィールの状態、ログアウト。",
  },
];
