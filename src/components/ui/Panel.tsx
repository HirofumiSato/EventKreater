import type { ElementType, HTMLAttributes, ReactNode } from "react";

type PanelProps = {
  children: ReactNode;
  /** 既定は `<section>`。すでに `<section>` の中に置く画面は `div` にする。 */
  as?: "section" | "div" | "nav" | "article";
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">;

/**
 * 画面の中の 1 枚の紙。見出し・本文・操作をまとめる。
 *
 * 中身の並びは画面ごとに違うので、部品は外枠だけを持つ。
 * `PanelHead` と組で使うと、見出しの位置が全画面で揃う。
 */
export function Panel({ children, as = "section", className, ...rest }: PanelProps) {
  const Tag = as as ElementType;
  return (
    <Tag className={className ? `panel ${className}` : "panel"} {...rest}>
      {children}
    </Tag>
  );
}

type PanelHeadProps = {
  /** 見出しの文字。要素ごと差し替えたいときは `titleAs` を変える。 */
  title: ReactNode;
  /** 見出しの下に置く一言。無い画面は省略する。 */
  note?: ReactNode;
  /** 見出しの右に置くボタンなど。 */
  children?: ReactNode;
  /** 既存の `<p className="panel__title">` を残すための切り替え。 */
  titleAs?: "h2" | "h3" | "p";
};

/** 紙の見出し。`.panel__head` の中に、題・補足・操作を並べる。 */
export function PanelHead({ title, note, children, titleAs: Title = "h2" }: PanelHeadProps) {
  return (
    <div className="panel__head">
      <Title className="panel__title">{title}</Title>
      {note ? <p className="panel__note">{note}</p> : null}
      {children}
    </div>
  );
}
