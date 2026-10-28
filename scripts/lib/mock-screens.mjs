// 画面の目録。モックの生成（scripts/mock-sync.mjs）と検査（scripts/check-mock-sync.mjs）が
// 同じ並びを使う。画面を足すときは、ここ 1 か所だけを直す。
//
// 製品が正で、モックは `npm run mock:sync` が写した生成物。目録はこの 1 つだけ。
//
// パスは `storage/ui-demo.json` の ID を受けて組み立てるので、`demo` を引数で受け取る。

export const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
];

/** ブラウザのデバッグ用ポート。 */
export const DEFAULT_DEBUG_PORT = 9333;

/** 一覧ページの見出し。 */
export const MOCK_GROUPS = [
  { key: "public", title: "公開", note: "誰でも開ける画面。初めて触る人が最初に見る。" },
  { key: "auth", title: "認証・設定", note: "入る前と、入ったあとの手続き。" },
  { key: "participant", title: "参加者", note: "参加する側の画面。催しを思い出すために開く。" },
  { key: "organizer", title: "主催者", note: "運営する側の画面。数字と行を追う。" },
];

/**
 * 画面と、その画面が見せる状態。
 *
 * - `slug`   … ファイル名の語幹
 * - `path`   … 開く URL。幅で変わる画面（使い捨てトークンなど）は関数
 * - `auth`   … `storage/ui-demo.json` のトークン名。null なら未ログイン
 * - `states` … 複数の状態を持つ画面だけ。先頭が既定（ファイル名に接尾辞を付けない）
 * - `theme`  … 状態ごとにセマンティックテーマを差し替える。文字列はそのテーマ ID、
 *              `null` はテーマ未選択（包みごと外す）、省けば DB のまま
 *
 * 開いた時点で状態が変わる画面（編集画面のロックなど）は `serial: true`。
 * 幅を同時に開くと後から開いた側が別の状態になるため、1 本ずつ開く。
 */
export function buildScreens(demo) {
  return [
    {
      no: "01",
      group: "public",
      slug: "home",
      name: "ホーム",
      path: "/",
      auth: null,
      note: "墨地のヒーロー、機能 3行、使い方、朱の帯。第一印象を作る画面。",
    },
    {
      no: "02",
      group: "public",
      slug: "service",
      name: "サービスと料金",
      path: "/service",
      auth: null,
      note: "無料 2回、単発 299円、月額 980円。ここから支払いは始めない。",
    },
    {
      no: "03",
      group: "public",
      slug: "terms",
      name: "利用規約",
      path: "/terms",
      auth: null,
      note: "料金、キャンペーン、0円の条件、通知、解約と返金。",
    },
    {
      no: "04",
      group: "public",
      slug: "event",
      name: "イベント告知・出欠",
      path: `/events/${demo.events.main}`,
      auth: null,
      note: "チラシを先頭に、その下で出欠。参加者が最初に見る画面。",
      states: [
        { key: "guest", label: "未ログイン", path: `/events/${demo.events.main}`, auth: null },
        {
          key: "member",
          label: "ログイン済み",
          path: `/events/${demo.events.main}`,
          auth: "participant",
        },
        { key: "full", label: "満員", path: `/events/${demo.events.full}`, auth: null },
        { key: "closed", label: "受付停止", path: `/events/${demo.events.closed}`, auth: null },
      ],
    },
    {
      no: "05",
      group: "public",
      slug: "event-receipt",
      name: "参加費の領収書",
      path: `/events/${demo.events.main}/receipt`,
      auth: "participant",
      note: "参加者本人の領収書。印刷して渡せる形。",
    },
    {
      no: "06",
      group: "public",
      slug: "organizer-public",
      name: "主催者のページ",
      path: `/organizers/${demo.organizerId}`,
      // プロフィールは誰でも読めるが、催しは参加者のログインが要る。
      // 未ログインで開くと、飾りのカレンダーの上に白塗りを重ねる。
      auth: null,
      note: "プロフィールの下に、カレンダーと一覧。未ログインではカレンダーの上に白塗りを重ねる。テーマは同じ画面を 5 つぶん撮り、未選択（標準）も 1 枚置く。",
      states: [
        { key: "guest", label: "未ログイン", path: `/organizers/${demo.organizerId}`, auth: null },
        {
          key: "member",
          label: "ログイン済み",
          path: `/organizers/${demo.organizerId}`,
          auth: "participant",
        },
        // 保存されているテーマはデモでは羊皮紙なので、ほかの 4 つと標準は
        // 撮る直前に属性を差し替えて作る（`applySemanticTheme`）。
        {
          key: "theme-none",
          label: "テーマ未選択",
          path: `/organizers/${demo.organizerId}`,
          auth: "participant",
          theme: null,
        },
        {
          key: "theme-modern-slate",
          label: "夜のスレート",
          path: `/organizers/${demo.organizerId}`,
          auth: "participant",
          theme: "modern-slate",
        },
        {
          key: "theme-enterprise-clean",
          label: "クリーン",
          path: `/organizers/${demo.organizerId}`,
          auth: "participant",
          theme: "enterprise-clean",
        },
        {
          key: "theme-parchment",
          label: "羊皮紙",
          path: `/organizers/${demo.organizerId}`,
          auth: "participant",
          theme: "parchment",
        },
        {
          key: "theme-neo-brutalism",
          label: "ネオ・ブルータリズム",
          path: `/organizers/${demo.organizerId}`,
          auth: "participant",
          theme: "neo-brutalism",
        },
        {
          key: "theme-neon",
          label: "ネオン",
          path: `/organizers/${demo.organizerId}`,
          auth: "participant",
          theme: "neon",
        },
      ],
    },
    {
      no: "07",
      group: "auth",
      slug: "register",
      name: "主催者のログイン・登録",
      path: "/auth/register",
      auth: null,
      note: "パスワードと、確認番号の 2 経路。Google も同じ画面。",
    },
    {
      no: "08",
      group: "auth",
      slug: "verify",
      name: "メールの確認",
      path: `/auth/verify?token=${demo.emailVerifyToken}`,
      auth: null,
      note: "確認メールのリンクを開いたあと。次は電話番号の確認。",
    },
    {
      no: "09",
      group: "auth",
      slug: "participant-login",
      name: "参加者ログイン",
      path: "/participant/login",
      auth: null,
      note: "電話番号と確認番号だけ。パスワードは要らない。",
    },
    {
      no: "10",
      group: "auth",
      slug: "invitation",
      name: "共同幹事の招待",
      path: `/invitations/${demo.inviteCode}`,
      auth: "coHost",
      note: "できること・できないことを並べ、加わるかどうかを取る。",
    },
    {
      no: "11",
      group: "auth",
      slug: "account",
      name: "アカウント設定",
      path: "/account",
      auth: "organizer",
      note: "表示名、メール、電話、パスワード、退会。主催者と参加者で共通。",
    },
    {
      no: "12",
      group: "auth",
      slug: "account-verify",
      name: "メールアドレスの確定",
      path: (width) => `/account/email/verify?token=${demo.emailChangeTokens[String(width)]}`,
      // 確定するとセッションが作り直される。他の画面の Cookie を巻き込まないよう、
      // 確認専用の会員で開く。
      auth: "verifyUser",
      note: "新しいアドレスの確認。成功したら設定へ戻す。",
    },
    {
      no: "13",
      group: "participant",
      slug: "participant",
      name: "参加者ホーム",
      path: "/participant",
      auth: "participant",
      note: "これからの参加、出席と欠席の件数、次の催し、履歴への導線。",
    },
    {
      no: "14",
      group: "participant",
      slug: "participant-calendar",
      name: "参加カレンダー",
      path: "/participant/calendar",
      auth: "participant",
      note: "答えた催しを開催日に置く。出席・要望・欠席を点で分ける。",
    },
    {
      no: "15",
      group: "participant",
      slug: "participant-history",
      name: "参加履歴",
      auth: "participant",
      note: "出欠と領収書の一覧。主催している催しは出さない。",
      states: [
        { key: "default", label: "履歴あり", path: "/participant/history", auth: "participant" },
        { key: "empty", label: "履歴なし", path: "/participant/history", auth: "coHost" },
      ],
    },
    {
      no: "16",
      group: "organizer",
      slug: "organizer",
      name: "主催一覧",
      path: "/organizer/events",
      auth: "organizer",
      note: "公開中と受付停止だけ。下書きは件数だけを添えて分ける。",
    },
    {
      no: "17",
      group: "organizer",
      slug: "organizer-calendar",
      name: "主催カレンダー",
      path: "/organizer/calendar",
      auth: "organizer",
      note: "月グリッドと、今月の催し一覧。複数の開催日はすべて出す。",
    },
    {
      no: "18",
      group: "organizer",
      slug: "revenue",
      name: "売上",
      path: "/organizer/revenue",
      auth: "organizer",
      note: "見込み・発行額・差額・平均単価。催し別の一覧が続く。",
    },
    {
      no: "19",
      group: "organizer",
      slug: "revenue-detail",
      name: "売上の内訳",
      path: `/organizer/events/${demo.events.main}/revenue`,
      auth: "organizer",
      note: "プラン別と開催回別。プラン未選択の案内を出す。",
    },
    {
      no: "20",
      group: "organizer",
      slug: "create",
      name: "新規イベント作成",
      path: "/organizer/events/new",
      auth: "organizer",
      note: "5ステップのアコーディオン。次へで畳まれ、次が開く。",
    },
    {
      no: "21",
      group: "organizer",
      slug: "edit",
      name: "イベントの編集",
      path: `/organizer/events/${demo.events.main}/edit`,
      auth: "organizer",
      note: "排他ロックの残り時間と、共同幹事の一覧・解除。",
      // 開いた時点でイベントのロックを取る。2 幅を同時に開くと、後から開いた側が
      // 「他の人が編集中」のモーダルになるので、幅を 1 本ずつ開く。
      serial: true,
    },
    {
      no: "22",
      group: "organizer",
      slug: "drafts",
      name: "下書き一覧",
      path: "/organizer/events/drafts",
      auth: "organizer",
      note: "自分の下書きだけ。プレビュー・編集・削除。",
    },
    {
      no: "23",
      group: "organizer",
      slug: "preview",
      name: "下書きのプレビュー",
      path: `/organizer/events/${demo.events.draft}/preview`,
      auth: "organizer",
      note: "ヘッダー直下の編集バーと、告知ページのプレビュー。出欠フォームは見た目だけ。",
    },
    {
      no: "24",
      group: "organizer",
      slug: "roster",
      name: "参加者名簿",
      path: `/organizer/events/${demo.events.main}/participants`,
      auth: "organizer",
      note: "表。行の軸が揃っていることが機能そのもの。",
    },
    {
      no: "25",
      group: "organizer",
      slug: "receipt",
      name: "幹事向け領収書",
      path: `/organizer/events/${demo.events.main}/receipts/${demo.receiptParticipant}`,
      auth: "organizer",
      note: "再発行と印刷。番号は変わらず、発行日だけが進む。",
    },
    {
      no: "26",
      group: "organizer",
      slug: "register-required",
      name: "公開直後の案内",
      path: `/organizer/register-required?event=${demo.events.main}`,
      auth: null,
      note: "共有 URL と、登録後にできること。未登録の幹事にだけ出す。",
    },
    {
      no: "27",
      group: "organizer",
      slug: "organizer-profile",
      name: "公開プロフィールの編集",
      path: "/organizer/profile",
      auth: "organizer",
      note: "公開の可否、アイコン画像、ページの見た目（5テーマ）、肩書き、自己紹介、エリア、ジャンル、X と Instagram。",
    },
    {
      no: "28",
      group: "organizer",
      slug: "mypage",
      name: "主催者マイページ",
      path: "/mypage",
      auth: "organizer",
      note: "直近 3件、利用枠と契約、プロフィールの状態、ログアウト。",
    },
  ];
}

/** 状態つきの画面を、状態ごとの 1 行に開く。 */
export function expandScreens(screens) {
  const rows = [];
  for (const screen of screens) {
    const states = screen.states ?? [
      { key: "default", label: "", path: screen.path, auth: screen.auth },
    ];
    states.forEach((state, index) => {
      // 先頭の状態が、その画面の代表。ファイル名に接尾辞を付けない。
      const canonical = index === 0;
      const file = mockFileFor(screen.slug, canonical ? null : state.key);
      rows.push({
        no: screen.no,
        group: screen.group,
        slug: screen.slug,
        name: screen.name,
        note: screen.note ?? "",
        stateKey: state.key,
        label: state.label ?? "",
        auth: state.auth ?? null,
        path: state.path,
        // `theme` は省くと「DB のまま」、`null` は「テーマ未選択」。undefined と null を
        // 区別するため、既定値は入れずにそのまま渡す。
        theme: state.theme,
        canonical,
        file,
        fileName: file.replace(/\.html$/, ""),
        // 画面まるごとの性質（開いた時点で状態が変わる等）は状態に依らず引き継ぐ。
        serial: Boolean(screen.serial),
      });
    });
  }
  return rows;
}

/** 状態の名前から、生成するモックのファイル名を決める。 */
export function mockFileFor(slug, stateKey) {
  if (!stateKey) return `mock-${slug}.html`;
  return `mock-${slug}-${stateKey}.html`;
}

/** 行の URL。幅で変わる画面があるので、幅を受け取る。 */
export function pathFor(row, width) {
  return typeof row.path === "function" ? row.path(width) : row.path;
}

/**
 * `--only=20,24`・`--only=1`・`--only=04-event-member`・`--only=create` のどれでも絞れる。
 *
 * 目録の No は 2 桁なので、`--only=1` は 01 としても読む。`mock-` は付けても付けなくてもよい。
 */
export function selectRows(rows, only) {
  if (!only) return rows;
  const wanted = new Set();
  for (const item of only) {
    wanted.add(item);
    wanted.add(item.replace(/^mock-/, ""));
    if (/^\d+$/.test(item)) wanted.add(item.padStart(2, "0"));
  }
  return rows.filter((row) =>
    [
      row.no,
      row.fileName,
      row.file,
      row.slug,
      `${row.slug}-${row.stateKey}`,
      `${row.no}-${row.slug}`,
      `${row.no}-${row.slug}-${row.stateKey}`,
    ].some((alias) => wanted.has(alias)),
  );
}

/**
 * リンクの対応表。製品の内部リンクを、対応するモックへ付け替えるために使う。
 *
 * キーは URL のパス部分（`?` より前）。値はモックのファイル名。
 * 同じパスに複数の状態がある画面は、代表（先頭の状態）を選ぶ。
 *
 * デモデータを受け取ったときは、催しや主催者の ID を `*` に置き換えた型も足す。
 * 撮るたびに ID は変わるので、完全一致だけだと一覧の「編集」「参加者を見る」が
 * 全部 `#` になる。`*` は 1 セグメントとして `rewriteInternalLinks` が照合する。
 */
export function linkTargets(rows, demo = null) {
  const map = new Map();
  for (const row of rows) {
    const url = pathFor(row, WIDTHS[WIDTHS.length - 1].width);
    const pathname = url.split("?")[0].split("#")[0];
    if (!map.has(pathname)) map.set(pathname, row.file);
  }
  for (const [pattern, file] of patternsOf(map, demo)) {
    if (!map.has(pattern)) map.set(pattern, file);
  }
  return map;
}

/**
 * 完全一致の対応表から、デモ ID を `*` にした型を作る。
 * 長い ID から置き換えるのは、短い ID が長い ID の一部に当たるのを避けるため。
 */
function patternsOf(targets, demo) {
  const ids = demoIds(demo);
  if (ids.length === 0) return [];

  const patterns = [];
  for (const [pathname, file] of targets) {
    let pattern = pathname;
    for (const id of ids) {
      pattern = pattern.split(`/${id}/`).join("/*/");
      if (pattern.endsWith(`/${id}`)) pattern = `${pattern.slice(0, -id.length)}*`;
    }
    if (pattern !== pathname) patterns.push([pattern, file]);
  }
  return patterns;
}

/** 目録のパスに出てくるデモデータの ID。短いものは後ろに回す。 */
function demoIds(demo) {
  if (!demo) return [];
  const values = [
    demo.organizerId,
    demo.receiptParticipant,
    demo.inviteCode,
    ...Object.values(demo.events ?? {}),
  ].filter((value) => typeof value === "string" && value.length > 0);
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

/**
 * 目録が期待するファイル名。デモデータを読まずに済むよう、ID は仮の値で埋める。
 * `npm run check` は DB も storage/ui-demo.json も持たない（CI でも走る）ため。
 */
const PLACEHOLDER_DEMO = {
  events: {
    main: "event-main",
    full: "event-full",
    closed: "event-closed",
    draft: "event-draft",
  },
  organizerId: "user-organizer",
  receiptParticipant: "participant-receipt",
  inviteCode: "code-invite",
  emailVerifyToken: "token-verify",
  emailChangeTokens: { "390": "token-390", "1280": "token-1280" },
};

export function expectedFiles() {
  return expandScreens(buildScreens(PLACEHOLDER_DEMO)).map((row) => row.file);
}

/** 目録のパスを、`src/app` からの `page.tsx` の位置に直す（テストで実在を見る）。 */
export function pageFileFor(pathWithQuery) {
  const pathname = pathWithQuery.split("?")[0].split("#")[0];
  const segments = pathname.split("/").filter(Boolean);
  const mapped = segments.map((segment) => DYNAMIC_SEGMENTS[segment] ?? segment);
  return mapped.length === 0 ? "src/app/page.tsx" : `src/app/${mapped.join("/")}/page.tsx`;
}

/** 仮の ID を、Next の動的セグメント名に戻すための対応。 */
const DYNAMIC_SEGMENTS = {
  "event-main": "[id]",
  "event-full": "[id]",
  "event-closed": "[id]",
  "event-draft": "[id]",
  "user-organizer": "[userId]",
  "participant-receipt": "[participantId]",
  "code-invite": "[code]",
};

/** 目録（画面名・パス・状態）を、テストからも引けるようにする。 */
export function placeholderScreens() {
  return expandScreens(buildScreens(PLACEHOLDER_DEMO));
}
