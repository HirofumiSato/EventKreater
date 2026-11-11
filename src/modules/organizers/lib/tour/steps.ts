/**
 * 主催者マイページの操作ガイド（スポットライトツアー）の 9 枚。
 *
 * 文言と対象をここ 1 か所に置く。画面（`MyPageGuideTour`）は並べ方と測り方だけを持ち、
 * 文を直すときに TSX を触らなくて済むようにする。DOM には触れない。
 *
 * イベント作成のガイド（`src/modules/events/lib/tour/steps.ts`）とは配列を分ける。
 * 対象も文言も違い、こちらは画面をまたぐ（`/mypage` と `/organizer/events`、名簿）ため、
 * 片方に枚数を足したときにもう片方の「3 / 9」がずれないようにする。
 */

/** ガイド 1 枚の識別子。保存するのは画面をまたぐ続き（`session.ts`）だけ。 */
export type MyPageGuideKey =
  | "welcome"
  | "referral"
  | "notifications"
  | "notificationLink"
  | "organizerEvents"
  | "inviteCoHost"
  | "organizerProfile"
  | "roster"
  | "final";

/**
 * ガイドが移る画面。催しの画面（名簿）は id が決まらないと開けないので、
 * `[id]` を置いた型紙で持ち、進むときに最初の催しの id で埋める。
 */
export type MyPageGuidePath =
  | "/mypage"
  | "/organizer/events"
  | "/organizer/events/[id]/participants";

/** 型紙の中で、催しの id に置き換わる区切り。 */
export const MY_PAGE_GUIDE_EVENT_ID = "[id]";

/** 吹き出しに出す文。1 文 1 用件で書く（AGENTS.md「規約」）。 */
export interface MyPageGuideCopy {
  title: string;
  /**
   * 段落の本文。箇条書きで足りる枚は省き、`bullets` だけを持つ。
   * 両方は書かない（同じことを 2 回言わない）。
   */
  body?: string;
  /**
   * 本文の代わりに出す箇条書き。番号は振らない（順番に意味が無いため）。
   * 並列の項目を 1 文に詰めると読みにくいときに使う。
   */
  bullets?: readonly string[];
  /** 本文の下に 1 行だけ添える注記。無い枚もある。 */
  note?: string;
}

export interface MyPageGuideStep {
  key: MyPageGuideKey;
  /**
   * この枚を出す画面。
   *
   * 進む先が今の画面と違うときは、画面がこのパスへ移り、移った先で同じガイドが
   * 保存した続きから出す（`/mypage` → `/organizer/events` → 名簿 → `/mypage`）。
   * `[id]` を含む型紙は、進むときに最初の催しの id で埋める（`guidePathWithEventId`）。
   */
  path: MyPageGuidePath;
  /**
   * 穴を空ける対象。複数あるときは外接矩形を 1 つにまとめる。
   * 見つからない枚は画面が前方へ飛ばす（後退はしない）。
   */
  targets: readonly string[];
  /** その枚に出す文。 */
  copy: MyPageGuideCopy;
  /** 最終枚か。「わかった」はここだけに出す。 */
  final: boolean;
  /** この枚の前に、右上のユーザーメニューを開くか。 */
  openUserMenu?: boolean;
  /** この枚の前に、対象の札の「その他の操作」を開くか。 */
  openDetails?: boolean;
  /**
   * 黒い面を出すか。省略すると出す。
   *
   * 1 枚目（ようこそ）だけ `false`。何の画面の案内かを先に見せる枚で、画面を暗くすると
   * 全体像が伝わらない。穴の枠・塞ぐ層・紙はそのまま出すので、触れないことと対象は伝わる
   * （イベント作成のガイドの挨拶と同じ扱い）。
   */
  scrim?: boolean;
}

/**
 * 9 枚の並び。
 *
 * 1 枚目は見出し（`h1.page-title`）を指す「ようこそ」で、何の案内かを先に告げる。
 * 2〜5 枚目は `/mypage` で、紹介・新着・通知・主催一覧を上から順に指す。画面の並びと
 * 同じ順に降りるので、どこを見ているかを見失わない。4 枚目だけはヘッダーの外にある
 * 通知一覧を指すため、ユーザーメニューを開いてから穴を空ける。
 * 6・7 枚目は `/organizer/events` へ移る。6 枚目は最初の札の「その他の操作」を開いて
 * 招待の入口を見せ（畳んだままだと対象が DOM に無い）、7 枚目は同じ画面の副メニューで
 * 公開プロフィールを指す。8 枚目は最初の催しの名簿へ移り、一番左の「集金」を指す
 * （集金はその場のトグルで記録する）。9 枚目は `/mypage` に戻り、右上の「使い方」を
 * 指して終わる。
 */
export const MYPAGE_GUIDE_STEPS: readonly MyPageGuideStep[] = [
  {
    key: "welcome",
    path: "/mypage",
    // 何も指さずに始めると、黒面だけが出て「何の画面か」が分からない。
    // 見出しを囲んで、この画面の案内であることを先に示す。
    targets: ["h1.page-title"],
    // 挨拶の枚は画面の全体像を見せる。黒い面を出すと、何の画面かが分からなくなる。
    scrim: false,
    copy: {
      title: "主催者ページのガイドにようこそ",
      body: "このページでよく使う場所を、順に案内します。",
      note: "「次へ」で進みます。いつでも閉じられます。",
    },
    final: false,
  },
  {
    key: "referral",
    path: "/mypage",
    targets: ['[data-guide-target="mypage-referral"]'],
    copy: {
      title: "紹介リンクはここからコピー",
      body: "このリンクから登録した人が初めて公開すると、無料チケットが2枚もらえます。",
      note: "1アカウント当たり上限10枚",
    },
    final: false,
  },
  {
    key: "notifications",
    path: "/mypage",
    targets: ["#notifications"],
    copy: {
      title: "新着がここに出ます",
      body: "参加者の回答や、紹介から登録した人の公開が届きます。",
    },
    final: false,
  },
  {
    key: "notificationLink",
    path: "/mypage",
    targets: ['#site-user-menu a[href="/notifications"]'],
    // 通知一覧は普段はメニューの中にある。開かないと対象が DOM に無い。
    openUserMenu: true,
    copy: {
      title: "通知一覧はここから",
      body: "右上のメニューの「通知」で、すべての通知を開けます。",
    },
    final: false,
  },
  {
    key: "organizerEvents",
    path: "/mypage",
    targets: ['nav.subnav a[href="/organizer/events"]'],
    copy: {
      title: "作ったイベントはここに並びます",
      body: "「主催一覧」で、告知ページの一覧を見られます。",
    },
    final: false,
  },
  {
    key: "inviteCoHost",
    path: "/organizer/events",
    targets: ['article.event-card:first-of-type [data-guide-target="invite-cohost"]'],
    // 招待の入口は札の「その他の操作」の中。開かないと対象が DOM に無い。
    // 札は一覧に複数並ぶので、最初の 1 枚だけを指す（すべて開くと穴が画面を覆う）。
    openDetails: true,
    copy: {
      title: "共同主催・幹事を招待できます",
      body: "各イベントの「その他の操作」から、一緒に運営する人を招待できます。",
    },
    final: false,
  },
  {
    key: "organizerProfile",
    path: "/organizer/events",
    targets: ['nav.subnav a[href="/organizer/profile"]'],
    copy: {
      title: "公開プロフィールはここから",
      body: "プロフィールページには、主催イベントのカレンダーも掲載されます。",
    },
    final: false,
  },
  {
    key: "roster",
    path: "/organizer/events/[id]/participants",
    targets: ['[data-guide-target="roster-collected"]'],
    copy: {
      title: "集金は名簿の左端で残せます",
      body: "一番左の「集金」を入れると、受け取った記録が残ります。",
      note: "売上は「売上を見る」で確かめられます。",
    },
    final: false,
  },
  {
    key: "final",
    path: "/mypage",
    targets: ['[data-guide-target="mypage-guide"]'],
    copy: {
      title: "ここから操作は再度確認できます",
      body: "右上の「使い方」を押すと、この案内をいつでも開き直せます。",
    },
    final: true,
  },
];

/** ボタンと読み上げ名。文と同じく、直す場所を 1 か所にまとめる。 */
export const MYPAGE_GUIDE_ACTION_COPY = {
  back: "戻る",
  next: "次へ",
  skip: "ガイドをスキップ",
  close: "ガイドを閉じる",
  done: "わかった",
} as const;

/**
 * キーから 1 枚を引く。知らないキーは例外にする（`eventGuideStep` と同じ扱い）。
 * 黙って先頭へ戻すと、保存したキーが古くなったときに別の枚を指してしまう。
 */
export function myPageGuideStep(key: MyPageGuideKey): MyPageGuideStep {
  const step = MYPAGE_GUIDE_STEPS.find((entry) => entry.key === key);
  if (!step) throw new Error(`unknown mypage guide step: ${key}`);
  return step;
}

/**
 * キーから何枚目かを引く（0 始まり）。画面をまたいで戻ってきたときに、
 * 保存した枚から再開するために使う。
 *
 * 知らないキーは `myPageGuideStep` が例外にするので、`-1` を返して
 * 先頭からやり直すことはしない（壊れた続きに別の枚を割り当てない）。
 */
export function myPageGuideIndex(key: MyPageGuideKey): number {
  return MYPAGE_GUIDE_STEPS.indexOf(myPageGuideStep(key));
}

/**
 * いまの画面が、その枚の画面か。
 *
 * `[id]` は 1 区間ぶんの何にでも当たる（催しの id は画面ごとに違う）。
 * 末尾の `/` は無視する。枚の数と区切りの数が違えば別の画面として扱う。
 */
export function guidePathMatches(template: string, pathname: string): boolean {
  const expected = template.replace(/\/+$/, "").split("/").filter(Boolean);
  const actual = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (expected.length !== actual.length) return false;
  return expected.every(
    (segment, index) => segment === MY_PAGE_GUIDE_EVENT_ID || segment === actual[index],
  );
}

/** 型紙に催しの id が入るか。入る枚は、進む前に id を調べる。 */
export function guidePathNeedsEventId(template: string): boolean {
  return template.split("/").includes(MY_PAGE_GUIDE_EVENT_ID);
}

/** 型紙の `[id]` を催しの id で埋める。入る場所が無ければそのまま返す。 */
export function guidePathWithEventId(template: string, eventId: string): string {
  return template
    .split("/")
    .map((segment) => (segment === MY_PAGE_GUIDE_EVENT_ID ? eventId : segment))
    .join("/");
}
