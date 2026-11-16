import type { CSSProperties } from "react";

type SkeletonProps = {
  /** 高さ。CSS の長さ（`1rem` / `4.5rem` / `18rem` など）。 */
  height?: string;
  /** 幅。既定は 100%。文字 1 行の代わりなら `60%` などにする。 */
  width?: string;
  /**
   * 角の丸み。文字の行は `line`、紙やカードは `card`。
   * 枠はほかの紙と同じ `--radius-lg` を使う（テーマで 0 になる）。
   */
  shape?: "line" | "card";
  className?: string;
};

/**
 * 読み込み中の骨格。中身の代わりに同じ大きさの帯を置き、本文の位置を先に決める。
 *
 * 色はチラシ作成中の骨格（`.candidate-skeleton`）と同じトークンを使う。
 * 回る〇（`Loading`）は見出しの下の 1 行にだけ使い、画面全体を置き換えない。
 */
export function Skeleton({
  height = "1rem",
  width = "100%",
  shape = "line",
  className,
}: SkeletonProps) {
  const style: CSSProperties = {
    display: "block",
    width,
    height,
    borderRadius: shape === "line" ? "2px" : "var(--radius-lg)",
    background:
      "linear-gradient(100deg, var(--color-slate-100) 30%, var(--color-bg) 50%, var(--color-slate-100) 70%)",
    backgroundSize: "220% 100%",
  };
  return <span className={className} style={style} aria-hidden="true" />;
}
