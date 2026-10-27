import type { ReactNode } from "react";

type PageHeaderProps = {
  /**
   * 画面の種類（「主催者」「参加者」など）。
   * 主催者画面はヘッダー直下の節（`OrganizerTabs`）が役割を示すので、省く。
   */
  eyebrow?: ReactNode;
  /** `h1` に出す題。 */
  title: ReactNode;
  /** 題の下の説明。 */
  lead?: ReactNode;
  /** 右上に置くボタン。`panel__actions` で包む。 */
  actions?: ReactNode;
};

/**
 * 画面のいちばん上の見出し。
 *
 * 外側の `<div>` はクラスを持たない（余白は親の `stack` が持つ）。
 * ここを直すと、全画面の見出しの並びが 1 回で変わる。
 */
export function PageHeader({ eyebrow, title, lead, actions }: PageHeaderProps) {
  return (
    <div>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 className="page-title">{title}</h1>
      {lead ? <p className="page-lead">{lead}</p> : null}
      {actions ? <div className="panel__actions">{actions}</div> : null}
    </div>
  );
}
