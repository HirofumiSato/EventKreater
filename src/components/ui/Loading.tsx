import type { HTMLAttributes, ReactNode } from "react";

type LoadingProps = {
  children?: ReactNode;
  /** 回る〇を出すか。既定は出す。 */
  spinner?: boolean;
  as?: "p" | "div" | "span";
} & Omit<HTMLAttributes<HTMLElement>, "children">;

/**
 * 読み込み中の 1 行。回る〇と文言を 1 組で持つ。
 *
 * 文言は画面ごとに違うので children で受ける。`spinner={false}` で〇を消す。
 * `<p>` を置けない場所（表のセルなど）は `as` を変える。
 */
export function Loading({ children = "読み込んでいます", spinner = true, as: Tag = "p", ...rest }: LoadingProps) {
  return (
    <Tag className="loading" {...rest}>
      {spinner ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </Tag>
  );
}
