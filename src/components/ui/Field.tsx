import type { ReactNode } from "react";

type FieldProps = {
  /** `label` の中身。「必須」の札（`req`）もここに入れる。 */
  label: ReactNode;
  /** 入力要素の id。`label` の `htmlFor` に使う。 */
  htmlFor: string;
  /** 入力の下に出す補足。 */
  help?: ReactNode;
  /** 入力の下に出すエラー。 */
  error?: ReactNode;
  /** 入力要素と、その他の補足。中身は画面が持つ。 */
  children: ReactNode;
};

/**
 * 入力 1 つ分の枠。`label`・`help`・`error` の 3 点だけをまとめる。
 *
 * 入力要素そのもの（`input` / `select` / `textarea`）は画面に残す。
 * 種類ごとに `className` や `autoComplete` が違うため、共通化すると自由度を落とす。
 */
export function Field({ label, htmlFor, help, error, children }: FieldProps) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help ? <p className="help">{help}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
