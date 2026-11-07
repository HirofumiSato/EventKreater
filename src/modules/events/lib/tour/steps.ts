import { EVENT_STEPS, type EventStepKey } from "@/modules/events/lib/steps";

/**
 * 新規イベント作成画面の初回ガイド（スポットライトツアー）の 8 枚。
 *
 * 文言と対象をここ 1 か所に置く。画面（`EventGuideTour`）は並べ方と測り方だけを持ち、
 * 文を直すときに TSX を触らなくて済むようにする。DOM には触れない。
 */

/** ガイド 1 枚の識別子。保存はしない（記憶するのは「閉じたか」だけ）。 */
export type EventGuideKey =
  | "welcome"
  | "required"
  | "schedule"
  | "pricing"
  | "target"
  | "theme"
  | "flyer"
  | "final";

/** 吹き出しに出す文。1 文 1 用件で書く（AGENTS.md「規約」）。 */
export interface EventGuideCopy {
  title: string;
  /**
   * 段落の本文。箇条書きで足りる枚は省き、`bullets` だけを持つ。
   * 両方は書かない（同じことを 2 回言わない）。
   */
  body?: string;
  /**
   * 本文の代わりに出す箇条書き。番号は振らない（順番に意味が無いため）。
   * 料金の 3 つの作り方のように、並列の項目を 1 文に詰めると読みにくいときに使う。
   */
  bullets?: readonly string[];
  /** 本文の下に 1 行だけ添える注記。無い枚もある。 */
  note?: string;
}

/**
 * その枚を出す前に、アコーディオンをどうするか。
 *
 * - `EventStepKey` … その 1 つだけを開く（ほかのステップは畳まれる）
 * - `"all"` … 全部開く。3 枚目から使う（下の `EventGuideStep.openStep` を見る）
 * - `"closed"` … 全部畳む。2 枚目で 3 つの見出しだけを見せるために使う
 * - `null` … 開閉を変えない
 */
export type EventGuideOpenMode = EventStepKey | "all" | "closed" | null;

export interface EventGuideStep {
  key: EventGuideKey;
  /**
   * 穴を空ける対象。複数あるときは外接矩形を 1 つにまとめる。
   * 見つからない枚は画面が前方へ飛ばす（後退はしない）。
   */
  targets: readonly string[];
  /**
   * この枚を出す前に開くステップ。
   *
   * - `EventStepKey` はその 1 つだけを開く（前のステップは畳まれる）
   * - `"all"` は全部開く。3 枚目から全部開いたまま、対象の 1 つへ順に降りる
   * - `"closed"` は全部畳む。2 枚目で 3 つの見出しを続けて見せるために使う
   * - `null` は開閉を変えない
   *
   * 2 枚目で「基本」を開いたままにすると、3 つの見出しのあいだに基本の入力欄が挟まり、
   * 外接矩形が画面の大半を覆って「どこを指しているか」が分からなくなる。
   * 3 枚目からすべて開くのは、1 つずつ開いて回ると「押すたびに他が閉じる」印象を与え、
   * 画面全体のどこを今見ているのかを見失うため。開いたままでも穴は 1 つに絞れる。
   */
  openStep: EventGuideOpenMode;
  /**
   * 対象を 1 つずつ別の穴で囲むか。省略すると全部をまとめた外接矩形 1 つになる。
   * 1 枚目の 3 つの見出しは、1 つの箱に入れると「3 つのうちどれか」が伝わらない。
   */
  separateTargets?: boolean;
  /**
   * 穴の中を押せるようにするか。押すと手の合図（`.guide-tap`）を出す。
   *
   * 既定は押せない（透明な層で塞ぐ）。ガイドの途中で値を変えたり対象を閉じたりすると、
   * 穴の位置がずれて説明と食い違うため。アコーディオンの見出しだけは、開いても閉じても
   * 壊れるものが無く、押して確かめられるほうが「開いたり閉じたりします」の意味が伝わる。
   */
  pressable?: boolean;
  /** ゲスト（未登録）に出す文。 */
  copy: EventGuideCopy;
  /** ログイン済みだけ差し替える文。無ければ `copy` をそのまま使う。 */
  signedInCopy?: EventGuideCopy;
  /** 最終枚か。「次回から表示しない」と「はじめる」はここだけに出す。 */
  final: boolean;
  /**
   * 黒い面を出すか。省略すると出す。
   *
   * 1 枚目（挨拶）だけ `false`。何の画面かを見せる枚で、画面を暗くすると全体像が
   * 伝わらない。穴の枠・塞ぐ層・紙はそのまま出すので、触れないことと対象は伝わる。
   */
  scrim?: boolean;
}

/**
 * 8 枚の並び。
 *
 * 1 枚目は入口の挨拶で、画面の見出し（`h1.page-title`）を指す。何の画面で、これから
 * 何が始まるかだけを伝え、アコーディオンは触らない（開いている「基本」はそのまま）。
 * 2 枚目で必須 3 ステップの見出しをまとめて指し、アコーディオンの開閉もここで伝える。
 * このときは全ステップを畳む。開いたままだと見出しのあいだが入力欄で埋まり、
 * 1 つの穴が画面の大半を覆ってしまう。3 つの見出しは 1 つずつ別の穴で囲む。
 * 3 枚目で全部を開き、以降はそのまま（`"all"`）で対象だけを移す。
 * 「次へ」のたびに 1 つ開いて他を畳むと、押すたびに画面が組み替わって落ち着かない。
 * 開いたままだと縦に長くなるが、穴は 1 つに絞れるので、どこを見ているかは失われない。
 * 最後に画面下の帯（公開・保存）へ降りる。テーマとチラシは同じステップの別の欄なので、
 * 6・7 枚目は開いたまま対象だけを移す。
 */
export const EVENT_GUIDE_STEPS: readonly EventGuideStep[] = [
  {
    key: "welcome",
    targets: ["h1.page-title"],
    // 入口では開閉を動かさない（既定で開いている「基本」をそのまま見せる）。
    openStep: null,
    // 挨拶の枚は画面の全体像を見せる。黒い面を出すと、何の画面かが分からなくなる。
    scrim: false,
    copy: {
      title: "新規イベント作成へようこそ",
      body: "このページの使い方を順にガイドします。",
      note: "「次へ」で進みます。いつでも閉じられます。",
    },
    final: false,
  },
  {
    key: "required",
    targets: [
      "#event-step-basic-toggle",
      "#event-step-pricing-toggle",
      "#event-step-location-toggle",
    ],
    openStep: "closed",
    separateTargets: true,
    // 見出しは押して開閉を試せる。手の合図を出し、穴の中の透明な層を外す。
    pressable: true,
    copy: {
      title: "必須入力は3つ。タップで開く",
      body: "名前と日時・料金・場所でプレビューに進めます。",
    },
    final: false,
  },
  {
    key: "schedule",
    targets: ['[data-guide-target="add-schedule"]'],
    // ここで全部開く。以降の枚も開いたまま（`"all"`）。
    openStep: "all",
    copy: {
      title: "開催日はこのボタンで、複数設定できます",
      body: "2 日目以降は「日時を追加」から。",
    },
    final: false,
  },
  {
    key: "pricing",
    targets: ["#event-step-pricing"],
    openStep: "all",
    copy: {
      title: "料金プランをカスタマイズ",
      bullets: ["男女別の金額", "飲み放題などの別プラン", "割引"],
    },
    final: false,
  },
  {
    key: "target",
    targets: ['[data-guide-target="target-generation"]'],
    openStep: "all",
    copy: {
      title: "対象を絞ると伝わりやすい",
      body: "公開ページに「対象」として出ます。",
    },
    final: false,
  },
  {
    key: "theme",
    targets: ["#event-step-flyer .event-step__block--theme"],
    openStep: "all",
    copy: {
      title: "イベント公開ページの見た目を選べます",
      body: "色と字の雰囲気が、ページとチラシにそろいます。",
    },
    final: false,
  },
  {
    key: "flyer",
    targets: ["#event-step-flyer .event-step__block--flyer"],
    openStep: "all",
    copy: {
      title: "チラシを載せるなら、ここで生成か自前の画像をアップ",
      body: "その場で作るか、手元の画像を上げられます。",
    },
    final: false,
  },
  {
    key: "final",
    targets: [".form-final"],
    // 最後は帯（保存・公開）を見せるだけ。開いたままのステップはそのままにする。
    openStep: null,
    copy: {
      title: "あとはプレビューを見て公開",
      body: "登録のあと、プレビューを見てから公開できます。",
      note: "入力はそのまま残ります。",
    },
    signedInCopy: {
      title: "あとはプレビューを見て公開",
      body: "プレビューで確かめてから公開できます。",
      note: "下書きにすれば、あとから続けられます。",
    },
    final: true,
  },
];

/** ボタンと読み上げ名。文と同じく、直す場所を 1 か所にまとめる。 */
export const EVENT_GUIDE_ACTION_COPY = {
  back: "戻る",
  next: "次へ",
  start: "はじめる",
  skip: "ガイドをスキップ",
  close: "ガイドを閉じる",
  dismiss: "次回から表示しない",
} as const;

/**
 * 最終枚で「次回から表示しない」を選んで閉じたときの確認。
 *
 * チェックは既定で入っている。押した瞬間に黙って消すと、次に開いたときに
 * ガイドが無い理由が分からないため、1 枚だけ確認を挟む。
 */
export const EVENT_GUIDE_DISMISS_NOTICE = {
  title: "ガイドは以降、表示しません",
  body: "次に開いたときは、この案内は出ません。",
  confirm: "OK",
} as const;

/** その枚に出す文。ログイン済みの差し替えがあれば、そちらを優先する。 */
export function guideCopy(step: EventGuideStep, signedIn: boolean): EventGuideCopy {
  return signedIn && step.signedInCopy ? step.signedInCopy : step.copy;
}

/**
 * キーから 1 枚を引く。知らないキーは例外にする（`eventStep` と同じ扱い）。
 * 黙って先頭へ戻すと、保存したキーが古くなったときに別の枚を指してしまう。
 */
export function eventGuideStep(key: EventGuideKey): EventGuideStep {
  const step = EVENT_GUIDE_STEPS.find((entry) => entry.key === key);
  if (!step) throw new Error(`unknown event guide step: ${key}`);
  return step;
}

/**
 * ガイドの枚に合わせて、開いているステップを決める。
 *
 * `"all"` は 5 つとも開く。3 枚目から使うので、以降は同じ集合が返り続ける
 * （同じ集合を返すと React が描き直さない）。`null` は今のまま。
 */
export function guideOpenKeys(
  mode: EventGuideOpenMode,
  current: Set<EventStepKey>,
): Set<EventStepKey> {
  if (mode === null) return current;
  if (mode === "closed") return current.size === 0 ? current : new Set<EventStepKey>();

  const keys: readonly EventStepKey[] =
    mode === "all" ? EVENT_STEPS.map((step) => step.key) : [mode];
  const unchanged = current.size === keys.length && keys.every((key) => current.has(key));
  return unchanged ? current : new Set(keys);
}
