import type { AllocationRole, RevenueShareVisibility, RevenueSplitMode } from "./lib/allocation";

/** 按分後の自分の取り分。横断の売上一覧で使う。 */
export interface RevenueShareAmount {
  expectedRevenue: number;
}

export interface RevenueAllocationRowView {
  organizerId: string;
  /** 解決済みの表示名。会員はアカウント名、ゲストは入力された名前。 */
  name: string;
  role: AllocationRole;
  isGuest: boolean;
  /** 閲覧者自身の行か。 */
  isYou: boolean;
  shareBps: number;
  headcount: number | null;
  expectedRevenue: number;
  issuedRevenue: number;
}

export interface RevenueAllocationView {
  /** 保存済みの設定があるか。無ければ均等割・OWN_ONLY で計算した結果を返す。 */
  configured: boolean;
  mode: RevenueSplitMode;
  visibility: RevenueShareVisibility;
  /** 配分を保存できるか（会員の主催者のみ）。 */
  canEdit: boolean;
  /** 絞り込む前の主催者数。1 人なら画面は按分の節を出さない。 */
  organizerCount: number;
  /** 閲覧範囲で絞った行。 */
  rows: RevenueAllocationRowView[];
  unallocated: {
    headcount: number;
    expectedRevenue: number;
    issuedRevenue: number;
  };
  /** 絞った結果として見えていない行数。 */
  hiddenRows: number;
}
