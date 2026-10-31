"use client";

import {
  SEMANTIC_THEME_GROUPS,
  type SemanticThemeGroup,
  type SemanticThemeId,
  semanticTheme,
  themesInGroup,
} from "@/lib/semantic-themes";

interface ThemePickerProps {
  /** 選んでいるテーマ。null は「標準」。 */
  value: SemanticThemeId | null;
  onChange: (theme: SemanticThemeId | null) => void;
  /** ラジオの name。同じ画面に複数の選択肢を置くときだけ変える。 */
  name?: string;
  /** 入力ステップの中に置くときは `compact`（見本を低くする）。 */
  variant?: "full" | "compact";
}

const STANDARD_NOTE = "いまの EventKreater の見た目。迷ったらこれ。";

interface PreviewCopy {
  eyebrow: string;
  title: string;
  meta: string;
  chips: readonly [string, string];
}

/**
 * 見本の文面。テーマの用途グループごとに変える。
 *
 * どのテーマでも「夜のジャズ」だと、昼の勉強会を選んでも夜の見本が出て、
 * 色だけを見比べることになる。題と時間帯を用途に合わせ、紙面の違いを
 * 題材ごと捉えられるようにする。
 */
const PREVIEW_COPY: Record<SemanticThemeGroup | "standard", PreviewCopy> = {
  standard: {
    eyebrow: "VOL.12 — 小さな集まり",
    title: "川辺でスープを煮る、小さな夕べ",
    meta: "11月15日（日）19:00 / 参宮橋のバー",
    chips: ["少人数", "初心者歓迎"],
  },
  calm: {
    eyebrow: "VOL.3 — 星を読む会",
    title: "冬の星座と、あなたの一年",
    meta: "12月6日（土）14:00 / 下北沢のサロン",
    chips: ["少人数", "要予約"],
  },
  bright: {
    eyebrow: "VOL.8 — はじめての勉強会",
    title: "React をいちから読む、土曜の午後",
    meta: "11月22日（土）13:00 / 渋谷の会議室",
    chips: ["初心者歓迎", "資料あり"],
  },
  vivid: {
    eyebrow: "VOL.5 — たこ焼きパーティー",
    title: "みんなで焼く、秋のタコパ",
    meta: "11月8日（土）18:00 / 世田谷の集会所",
    chips: ["子ども連れOK", "手ぶらで"],
  },
  night: {
    eyebrow: "VOL.12 — 夜のライブ",
    title: "小さな灯りで聴く、ジャズの夜",
    meta: "11月15日（日）19:00 / 参宮橋のバー",
    chips: ["1ドリンク付", "20席限定"],
  },
};

/**
 * 公開ページのテーマ選択。
 *
 * 9 つを 1 列に並べると選びにくいので、用途（落ち着き・明るい・元気・夜）で束ね、
 * チップで選ばせる。選んだテーマは下の見本にそのまま出る。
 *
 * 見本は画像を持たない。`data-semantic-theme` を付けた面が themes.css の
 * トークンを読むだけなので、テーマを増やしても読み込みは増えない。
 * 選択は保存するまで確定しない（親のフォームが持つ）。
 */
export function ThemePicker({
  value,
  onChange,
  name = "profile-theme",
  variant = "full",
}: ThemePickerProps) {
  const selected = semanticTheme(value);
  const preview = PREVIEW_COPY[selected?.group ?? "standard"];

  return (
    <div className={`theme-picker${variant === "compact" ? " theme-picker--compact" : ""}`}>
      <div className="theme-picker__groups">
        <div className="theme-picker__group">
          <p className="theme-picker__group-label">
            標準<span className="theme-picker__group-note">はじめてならここから</span>
          </p>
          <div className="theme-picker__chips">
            <label className="theme-chip">
              <input
                type="radio"
                name={name}
                value=""
                checked={value === null}
                onChange={() => onChange(null)}
              />
              <span className="theme-chip__dot theme-chip__dot--plain" aria-hidden="true" />
              <span className="theme-chip__label">標準</span>
            </label>
          </div>
        </div>

        {SEMANTIC_THEME_GROUPS.map((group) => (
          <div className="theme-picker__group" key={group.id}>
            <p className="theme-picker__group-label">
              {group.label}
              <span className="theme-picker__group-note">{group.note}</span>
            </p>
            <div className="theme-picker__chips">
              {themesInGroup(group.id).map((theme) => (
                <label className="theme-chip" key={theme.id}>
                  <input
                    type="radio"
                    name={name}
                    value={theme.id}
                    checked={value === theme.id}
                    onChange={() => onChange(theme.id)}
                  />
                  <span
                    className="theme-chip__dot semantic-theme"
                    data-semantic-theme={theme.id}
                    aria-hidden="true"
                  />
                  <span className="theme-chip__label">{theme.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="theme-preview">
        {/* 標準のときはテーマの変数を付けない。付けると --st-* が未定義になり、
            色が継承元へ落ちて見本だけ崩れる。 */}
        <div
          className={`theme-preview__frame${value ? " semantic-theme" : ""}`}
          data-semantic-theme={value ?? undefined}
        >
          <div className="theme-preview__card">
            <p className="theme-preview__eyebrow">{preview.eyebrow}</p>
            <p className="theme-preview__title">{preview.title}</p>
            <p className="theme-preview__meta">{preview.meta}</p>
            <div className="theme-preview__chips">
              {preview.chips.map((chip) => (
                <span className="theme-preview__chip" key={chip}>
                  {chip}
                </span>
              ))}
            </div>
            <div className="theme-preview__row">
              <span className="theme-preview__input">お名前</span>
              <span className="theme-preview__button">申し込む</span>
            </div>
          </div>
          <div className="theme-preview__cal">
            {[8, 9, 10, 11, 12, 13, 14].map((day) => (
              <span className="theme-preview__day" key={day}>
                {day}
              </span>
            ))}
            <span className="theme-preview__day theme-preview__day--on">15</span>
            {[16, 17, 18, 19, 20, 21].map((day) => (
              <span className="theme-preview__day" key={day}>
                {day}
              </span>
            ))}
          </div>
        </div>
        <p className="theme-preview__caption">
          {selected ? `${selected.label}。${selected.note}` : STANDARD_NOTE}
        </p>
      </div>
    </div>
  );
}
