"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatPostalCode, normalizePostalCode } from "@/lib/postal-code";
import { Alert } from "@/components/ui";
import {
  lookupPostalCode,
  shouldAutoSearchPostalCode,
  type PostalCodeResult,
} from "@/modules/events/lib/postal-code-search";

interface PostalCodeFieldProps {
  value: string;
  disabled?: boolean;
  /** 入力した郵便番号だけを反映する（検索しなくても保存できるようにする）。 */
  onChange?: (postalCode: string) => void;
  /** 郵便番号を選んだら、都道府県・市区町村・町域もまとめて反映する。 */
  onSelect: (result: PostalCodeResult & { postalCode: string }) => void;
}

/** 7 桁目を打ってから検索するまでの待ち。打っている途中のコードでは引かない。 */
const AUTO_SEARCH_DELAY_MS = 350;

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
  // 自動で引いたコード。同じコードを打ち直しても、もう一度は引かない。
  const autoCodeRef = useRef(normalizePostalCode(value));
  const autoTimerRef = useRef<number | null>(null);
  // 古い応答を捨てるための通し番号。打ち直したら前の結果は使わない。
  const requestRef = useRef(0);

  // 音声入力や下書きの復元で外から値が来たら、欄の表示も合わせる。
  // 打っている途中（「150-0001」のハイフンなど）は数字が同じなので触らない。
  useEffect(() => {
    const external = normalizePostalCode(value);
    setQuery((current) => (normalizePostalCode(current) === external ? current : value));
  }, [value]);

  const search = useCallback(
    async (raw: string) => {
      const code = normalizePostalCode(raw);
      if (code.length !== 7) {
        setError("郵便番号は7桁の数字で入力してください。");
        setResults(null);
        return;
      }
      const request = requestRef.current + 1;
      requestRef.current = request;
      setLoading(true);
      setError(null);
      setResults(null);
      try {
        const found = await lookupPostalCode(code);
        if (request !== requestRef.current) return;
        if (found.length === 1) {
          onSelect({ postalCode: code, ...found[0] });
        } else if (found.length > 1) {
          setResults(found);
        } else {
          setError("この郵便番号の住所が見つかりませんでした。番地から手入力してください。");
        }
      } catch (cause) {
        if (request !== requestRef.current) return;
        // 自動で引いた回は、もう一度打ち直せば引き直せるようにする。
        if (autoCodeRef.current === code) autoCodeRef.current = "";
        setError(cause instanceof Error ? cause.message : "住所を検索できませんでした。");
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [onSelect],
  );

  // 自動検索の待ちから最新の search を呼ぶ。onSelect は毎回作り直されるため。
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(
    () => () => {
      if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current);
    },
    [],
  );

  /** 7 桁がそろったら、打ち終わりを待って 1 回だけ引く。 */
  const scheduleAutoSearch = (code: string) => {
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (!shouldAutoSearchPostalCode(autoCodeRef.current, code)) return;
    autoCodeRef.current = code;
    autoTimerRef.current = window.setTimeout(() => {
      autoTimerRef.current = null;
      void searchRef.current(code);
    }, AUTO_SEARCH_DELAY_MS);
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
            const next = event.target.value;
            setQuery(next);
            onChange?.(normalizePostalCode(next));
            scheduleAutoSearch(normalizePostalCode(next));
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void search(query);
          }}
        />
        <button
          type="button"
          className="btn btn--outline btn--sm"
          disabled={disabled || loading}
          onClick={() => void search(query)}
        >
          {loading ? "検索中…" : "住所を検索"}
        </button>
      </div>
      <p className="help">
        7桁の数字（ハイフン可）を入れると、都道府県・市区町村・町域が入ります。見つからないときは手入力してください。
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
      {error && <Alert tone="warning">{error}</Alert>}
    </div>
  );
}
