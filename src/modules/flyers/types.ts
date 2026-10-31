/** ブラウザとサーバーで共有するチラシの型。 */
import type { FlyerAsset, RainPolicy } from "@/modules/events/types";

/**
 * 候補の種類。`layout` / `palette` / `title_color` は 5 ステップだった頃の
 * 名残で、古いサービス応答を読めるようにだけ残す。画面は作らない。
 */
export type FlyerCandidateKind =
  | "type"
  | "background"
  | "layout"
  | "palette"
  | "title_color";

/** ウィザードのタイル 1 枚。画像 URL は BFF の中継先を指す。 */
export interface FlyerCandidate {
  candidateId: string;
  kind: FlyerCandidateKind;
  label: string;
  description: string;
  imageUrl: string;
  templateId: string;
  layoutId: string;
  paletteId: string;
  accentColor: string;
  overlayAlpha: number;
  /** タイトルの文字色。`null` は「自動」で、背景の明るさから決まる。 */
  titleColor: string | null;
  /** 背景の供給元。`ai` のときだけ課金が起きる。 */
  source: string;
  /** AI 背景の残り枚数。背景候補のステップだけ入る。 */
  aiRemaining: number | null;
  /** 前段で選んだテーマに合う 1 枚。紙面の性格のステップだけ立つ。 */
  recommended: boolean;
}

export interface FlyerQuota {
  limit: number;
  used: number;
  remaining: number;
  anonymous: boolean;
}

/**
 * チラシ選択モーダルに出す 1 件。生成でもアップロードでも同じ形で扱い、
 * 選ぶと作成フォームの 7 項目へ流し込む。
 */
export interface SelectableFlyer extends FlyerAsset {
  title: string | null;
  eventDate: string | null;
  eventTime: string | null;
  price: string | null;
  location: string | null;
  rainPolicy: RainPolicy | null;
  capacity: number | null;
}

/**
 * ウィザードの段。1 = 背景、2 = 紙面の性格。
 *
 * 文字の配置・配色・題名色は選ばせない。配置は生成時の構図と食い違い、
 * 題名色は可読性の判断を利用者へ押し付けることになる。どれも描画側が決める。
 */
export type FlyerWizardStep = 1 | 2;
