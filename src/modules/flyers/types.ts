/** ブラウザとサーバーで共有するチラシの型。 */
import type { FlyerAsset, RainPolicy } from "@/modules/events/types";

export type FlyerCandidateKind = "type" | "background" | "layout" | "palette";

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
  /** 背景の供給元。`ai` のときだけ課金が起きる。 */
  source: string;
  /** AI 背景の残り枚数。背景候補のステップだけ入る。 */
  aiRemaining: number | null;
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

export type FlyerWizardStep = 1 | 2 | 3 | 4;
