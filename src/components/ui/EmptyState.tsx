import type { HTMLAttributes, ReactNode } from "react";

type EmptyStateProps = {
  children: ReactNode;
  /** 既定は `<p>`。`empty__title` などを `<div>` で組む画面だけ `div` にする。 */
  as?: "p" | "div";
} & Omit<HTMLAttributes<HTMLElement>, "children">;

/**
 * まだ何も無いときの 1 枚。
 *
 * 中の `<span className="empty__title">` と `<span className="empty__body">` は
 * そのまま子として渡す。見出しと本文の有無は画面で違うため、部品は外枠だけを持つ。
 * `<p>` の中に `<p>` は置けないので、段落を入れる画面は `as="div"` にする。
 */
export function EmptyState({ children, as: Tag = "p", ...rest }: EmptyStateProps) {
  return (
    <Tag className="empty" {...rest}>
      {children}
    </Tag>
  );
}
