/** ブラウザとサーバーで共有するチラシの型。 */

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
}

export interface FlyerQuota {
  limit: number;
  used: number;
  remaining: number;
  anonymous: boolean;
}

export type FlyerWizardStep = 1 | 2 | 3 | 4;
