import type { ElementType, HTMLAttributes, ReactNode } from "react";

type SectionProps = {
  children: ReactNode;
  as?: "section" | "div";
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">;

/** 画面を縦に区切る 1 まとまり。見出しは `SectionHead` が持つ。 */
export function Section({ children, as = "section", className, ...rest }: SectionProps) {
  const Tag = as as ElementType;
  return (
    <Tag className={className ? `section ${className}` : "section"} {...rest}>
      {children}
    </Tag>
  );
}

type SectionHeadProps = {
  title: ReactNode;
  note?: ReactNode;
  /** 見出しの右に置くボタンなど。 */
  children?: ReactNode;
};

/** 区切りの見出し。下線は `.section__head` が持つ。 */
export function SectionHead({ title, note, children }: SectionHeadProps) {
  return (
    <div className="section__head">
      <h2 className="section__title">{title}</h2>
      {note ? <p className="section__note">{note}</p> : null}
      {children}
    </div>
  );
}
