"use client";

import {
  SEMANTIC_THEMES,
  type SemanticThemeId,
} from "@/lib/semantic-themes";

interface ThemePickerProps {
  /** 選んでいるテーマ。null は「標準」。 */
  value: SemanticThemeId | null;
  onChange: (theme: SemanticThemeId | null) => void;
  /** ラジオの name。同じ画面に複数の選択肢を置くときだけ変える。 */
  name?: string;
}

/**
 * 公開ページのテーマ選択。
 *
 * 色見本は `data-semantic-theme` を付けた小さな面で描く。画像を使わないので、
 * テーマを増やしても読み込みは増えない。選択は保存するまで確定しない（親のフォームが持つ）。
 */
export function ThemePicker({ value, onChange, name = "profile-theme" }: ThemePickerProps) {
  return (
    <div className="theme-options">
      <label className="theme-option">
        <input
          type="radio"
          name={name}
          value=""
          checked={value === null}
          onChange={() => onChange(null)}
        />
        <span className="theme-swatch theme-swatch--default" aria-hidden="true">
          <span className="theme-swatch__card" />
          <span className="theme-swatch__line" />
        </span>
        <span className="theme-option__body">
          <span className="theme-option__label">標準</span>
          <span className="theme-option__note">いまの EventKreater の見た目。迷ったらこれ。</span>
        </span>
      </label>

      {SEMANTIC_THEMES.map((theme) => (
        <label key={theme.id} className="theme-option">
          <input
            type="radio"
            name={name}
            value={theme.id}
            checked={value === theme.id}
            onChange={() => onChange(theme.id)}
          />
          <span
            className="theme-swatch semantic-theme"
            data-semantic-theme={theme.id}
            aria-hidden="true"
          >
            <span className="theme-swatch__card" />
            <span className="theme-swatch__line" />
            <span className="theme-swatch__accent" />
          </span>
          <span className="theme-option__body">
            <span className="theme-option__label">{theme.label}</span>
            <span className="theme-option__note">{theme.note}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
