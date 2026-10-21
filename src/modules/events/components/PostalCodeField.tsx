"use client";

import { useState } from "react";
import { formatPostalCode, normalizePostalCode } from "@/lib/postal-code";
import { readProblem } from "@/lib/problem";

export interface PostalCodeResult {
  prefecture: string;
  city: string;
  town: string;
}

interface PostalCodeFieldProps {
  value: string;
  disabled?: boolean;
  /** 入力した郵便番号だけを反映する（検索しなくても保存できるようにする）。 */
  onChange?: (postalCode: string) => void;
  /** 郵便番号を選んだら、都道府県・市区町村・町域もまとめて反映する。 */
  onSelect: (result: PostalCodeResult & { postalCode: string }) => void;
}

export function PostalCodeField({
  value,
  disabled = false,
  onChange,
  onSelect,
}: PostalCodeFieldProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<PostalCodeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const code = normalizePostalCode(query);
    if (code.length !== 7) {
      setError("郵便番号は7桁の数字で入力してください。");
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/v1/geo/postal-codes/${code}`);
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { results: PostalCodeResult[] };
      if (body.results.length === 1) {
        onSelect({ postalCode: code, ...body.results[0] });
      } else {
        setResults(body.results);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "住所を検索できませんでした。");
    } finally {
      setLoading(false);
    }
  };

  const choose = (result: PostalCodeResult) => {
    onSelect({ postalCode: normalizePostalCode(query), ...result });
    setResults(null);
  };

  return (
    <div className="field postal-field">
      <label className="label" htmlFor="event-postal-code">
        郵便番号から住所を入れる
      </label>
      <div className="input-row">
        <input
          id="event-postal-code"
          className="input"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={8}
          disabled={disabled}
          value={query}
          placeholder="1500001"
          onChange={(event) => {
            setQuery(event.target.value);
            onChange?.(normalizePostalCode(event.target.value));
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void search();
          }}
        />
        <button
          type="button"
          className="btn btn--outline btn--sm"
          disabled={disabled || loading}
          onClick={() => void search()}
        >
          {loading ? "検索中..." : "住所を検索"}
        </button>
      </div>
      <p className="help">
        7桁の数字（ハイフン可）を入れて検索すると、都道府県・市区町村・町域が入ります。見つからないときは手入力してください。
        {value ? ` 保存する郵便番号: ${formatPostalCode(value)}` : ""}
      </p>
      {results && results.length > 0 && (
        <div className="choice-group choice-group--stack">
          {results.map((result) => (
            <button
              key={`${result.prefecture}${result.city}${result.town}`}
              type="button"
              className="choice choice--left"
              disabled={disabled}
              onClick={() => choose(result)}
            >
              {result.prefecture}
              {result.city}
              {result.town}
            </button>
          ))}
        </div>
      )}
      {error && <p className="alert alert--warning">{error}</p>}
    </div>
  );
}
