import type { HTMLAttributes, ReactNode } from "react";

/** 色の名前。CSS の `badge--{tone}` と 1 対 1 で対応する。 */
export type BadgeTone = "attending" | "declined" | "tentative" | "waitlist" | "neutral" | "success" | "warning";

type BadgeProps = {
  tone?: BadgeTone;
  /** 名簿の行内など、本文より小さく出すとき。 */
  small?: boolean;
  /** 見出しの横に並べるとき。 */
  inline?: boolean;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

/**
 * 状態の札。
 *
 * `tone` は文字列を組み立てず、この型のどれかを渡す。出欠の色は `rsvpStatusTone()` が
 * `RsvpTone`（この型の一部）を返すので、そのまま渡せる。
 * 色を足すときは CSS の `badge--{tone}` と `BadgeTone` の両方に 1 回ずつ足す。
 */
export function Badge({ tone = "neutral", small = false, inline = false, children, ...rest }: BadgeProps) {
  const classes = ["badge", `badge--${tone}`];
  if (small) classes.push("badge--sm");
  if (inline) classes.push("badge--inline");
  return (
    <span className={classes.join(" ")} {...rest}>
      {children}
    </span>
  );
}
