import type { HTMLAttributes, ReactNode } from "react";

/** 出す場所で色が決まる、短い知らせ。エラー・注意・情報・完了の 4 つ。 */
export type AlertTone = "error" | "warning" | "info" | "success";

type AlertProps = {
  tone: AlertTone;
  children: ReactNode;
  /** 既定は `<p>`。中に `<div>` を置くときだけ `div` にする。 */
  as?: "p" | "div";
  /** 余白だけ足したいときに使う。tone のクラスは消さない。 */
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">;

/**
 * 画面の上に 1 行で出す知らせ。
 *
 * 見た目は `alert` と `alert--{tone}` が持つ。要素は既定で `<p>`。
 * 中にリンクを置くときも `<p>` のままでよい（`<p>` の中に `<a>` は置ける）。
 * 入力の直下など `<div>` が要る場所だけ `as="div"` を渡す。
 */
export function Alert({ tone, children, as: Tag = "p", className, ...rest }: AlertProps) {
  const classes = ["alert", `alert--${tone}`];
  if (className) classes.push(className);
  return (
    <Tag className={classes.join(" ")} {...rest}>
      {children}
    </Tag>
  );
}
