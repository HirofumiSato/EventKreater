import type { EventStepKey } from "@/modules/events/lib/steps";
import type { EventFormValues } from "@/modules/events/types";

/**
 * 音声で埋められる欄。既存の入力欄と 1 対 1 で対応する。
 * ここに無い欄（行の追加ボタンなど）は音声の対象にしない。
 */
export type VoiceFieldKey =
  | "title"
  | "organizerName"
  | "scheduleDate"
  | "scheduleStart"
  | "scheduleEnd"
  | "planName"
  | "planAmount"
  | "planNote"
  | "venueName"
  | "postalCode"
  | "prefecture"
  | "city"
  | "town"
  | "addressLine"
  | "building"
  | "rainPolicy"
  | "capacity"
  | "rsvpDeadline";

/**
 * 音声で埋める 1 マス。欄のキーと行の番号を `:` でつなぐ（`scheduleDate:1`）。
 * 行を持たない欄も `title:0` のように 0 を付けて 1 つの形にする。
 */
export type VoiceSlotId = `${VoiceFieldKey}:${number}`;

/** フォームへの部分更新。行の配列は丸ごと差し替える。 */
export type VoicePatch = Partial<EventFormValues>;

/** 抽出に渡す文脈。`now` を受け取るのは、相対日付をテストで固定するため。 */
export interface VoiceContext {
  /** 今日の日付。日本時間の暦で扱う。 */
  now: Date;
  /** いまのフォームの値。行の index を決めるのに使う。 */
  value: EventFormValues;
  /**
   * 対象の行。開催日時は `schedules` の index、費用プラン名は組の index、
   * 金額・補足は `pricePlans` の index。省略したら 0（先頭の行）として扱う。
   */
  row?: number;
}

/** 聞き取りの対象にする条件。ゲスト幹事の主催者名など、画面に無い欄を除くために使う。 */
export interface VoiceFieldOptions {
  /** 未登録の幹事にだけ主催者名を聞く（`showOrganizerName`）。 */
  showOrganizerName: boolean;
}

export interface VoiceField {
  key: VoiceFieldKey;
  /** 画面に出す欄の名前。「開催日」など。行が無いときの名前でもある。 */
  label: string;
  /**
   * 行を付けたときの名前（「2件目の開催日」「女性の金額」）。
   * 行で言い方が変わらない欄は持たない。
   */
  labelFor?: (value: EventFormValues, row: number) => string;
  /** この欄を出すステップ。閉じているときは開いてから強調する。 */
  step: EventStepKey;
  /**
   * 強調する要素の id。既存の入力欄が持つ id をそのまま返す。
   * 行が無いときは null を返し、その欄は飛ばす。
   */
  domId: (value: EventFormValues, row: number) => string | null;
  /** 空欄かどうか。空欄だけを上から順に巡回する。 */
  isEmpty: (value: EventFormValues, row: number) => boolean;
  /** 誘導文。「開催日を話してください」。 */
  prompt: string;
  /** 入力例。パネルに出す。 */
  example: string;
  /** 認識モデルに渡す語彙のヒント。欄の文脈を絞るために使う。 */
  hint: string;
  /** この欄を巡回に含めるか。主催者名のように条件付きの欄だけが持つ。 */
  applies?: (value: EventFormValues, scope: VoiceFieldScope) => boolean;
  /**
   * 既定値を持つ欄。空欄にならないので、`includeOptional` が true のときだけ、
   * まだ触っていない場合に巡回する。
   */
  optional?: boolean;
  /** 発話をパッチへ変える。読めなければ null（＝聞き直し）。 */
  parse: (text: string, context: VoiceContext) => VoicePatch | null;
}

/** 巡回の対象を決める指定。 */
export interface VoiceFieldScope extends VoiceFieldOptions {
  /**
   * 既定値を持つ欄（雨天時の方針・定員・申し込み期限）も巡回するか。
   * これらは「空欄」にならないため、対象はパネルの切り替えで決める（既定はオン）。
   */
  includeOptional: boolean;
  /** このセッションで一度でも音声で入れた欄。任意欄を聞き直さないために使う。 */
  touched: ReadonlySet<VoiceFieldKey>;
}

/**
 * 巡回する 1 マス。欄の定義と行の番号を組にしたもの。
 * 画面はこの単位でカーソルを持ち、行ごとの欄を 1 つずつ埋めていく。
 */
export interface VoiceSlot {
  /** `欄のキー:行` の形。カーソルと DOM の逆引きはこの id で行う。 */
  id: VoiceSlotId;
  /** 欄のキー。`touched` やパッチの判定に使う。 */
  key: VoiceFieldKey;
  /**
   * 行の番号。開催日時は `schedules` の index、費用プラン名は組の index、
   * 金額・補足は `pricePlans` の index。
   */
  row: number;
  /** 画面に出す欄の名前。「2件目の開催日」「女性の金額」など。 */
  label: string;
  /** 誘導文。行を付けた名前のときは「2件目の開催日は？」になる。 */
  prompt: string;
  /** この欄を出すステップ。 */
  step: EventStepKey;
  /** 欄の定義。入力例・ヒント・`parse` はここから読む。 */
  field: VoiceField;
  /** 強調する要素の id。行はすでに決まっているので値だけを受け取る。 */
  domId: (value: EventFormValues) => string | null;
}
