import type { ReactNode } from "react";

/** 行の束。行そのものは `Row` が持つ。 */
export function Rows({ children }: { children: ReactNode }) {
  return <ul className="rows">{children}</ul>;
}

type RowProps = {
  /** 行の題。リンクを入れる画面は ReactNode で渡す。 */
  title: ReactNode;
  /** 題の下の補足。無い行は省略する。 */
  meta?: ReactNode;
  /** 右端に置く値やボタン。 */
  aside?: ReactNode;
  /** 題と補足の下に足す行（リンクなど）。 */
  children?: ReactNode;
};

/**
 * 一覧の 1 行。左に題と補足、右に値を置く。
 *
 * `rows__main` の組み方（題・補足・追加の段落）をここが持つので、
 * 行の並びを変えるときはこの 1 箇所を直す。
 */
export function Row({ title, meta, aside, children }: RowProps) {
  return (
    <li className="rows__item">
      <div className="rows__main">
        <p className="rows__title">{title}</p>
        {meta ? <p className="rows__meta">{meta}</p> : null}
        {children}
      </div>
      {aside}
    </li>
  );
}
