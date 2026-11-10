"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bold, Italic, Link2, List, Underline, Unlink } from "lucide-react";
import { Dialog } from "@/components/ui";
import { isImeEnter } from "@/lib/ime";
import {
  EVENT_SUMMARY_MAX_LENGTH,
  escapeSummaryHtml,
  normalizeSummaryLinkUrl,
  summaryTextLength,
} from "@/modules/events/lib/summary";

export interface EventSummaryEditorProps {
  /** 本文の id。`Field` の `htmlFor` と結び付ける。 */
  id: string;
  /** 保存する HTML。書式は許可タグだけに絞ってある。 */
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
}

/** 選択範囲を含む一番近いリンク。リンクの中で押したときだけ返す。 */
function anchorAround(node: Node | null): HTMLAnchorElement | null {
  if (!node) return null;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return element?.closest("a[href]") ?? null;
}

/** リンクの href に埋め込む前の最小限の無害化。 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 選択位置で効いている書式。ツールバーの押下状態に使う。 */
function commandActive(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    // 書式を調べられない環境では「効いていない」として扱う。
    return false;
  }
}

/**
 * 概要のリッチテキスト。本文は `contentEditable` の 1 枚で、書式はツールバーだけから入れる。
 *
 * 音声入力の自動巡回（1つずつ／まとめて）からは外す。書式付きの本文は 1 つの入力欄として
 * 読み書きできないため、`VOICE_FIELDS` に `summary` を足さず、`data-voice-target` も付けない。
 */
export function EventSummaryEditor({
  id,
  value,
  onChange,
  disabled = false,
}: EventSummaryEditorProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** リンクの Dialog を開く前の選択範囲。開いた時点で本文の選択は外れるので控える。 */
  const savedRange = useRef<Range | null>(null);
  /** 選択位置にあったリンク。URL の差し替えに使う。 */
  const savedAnchor = useRef<HTMLAnchorElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pressed, setPressed] = useState({
    bold: false,
    italic: false,
    underline: false,
    list: false,
  });

  const countId = `${id}-count`;
  const linkTitleId = `${id}-link-title`;
  const linkUrlId = `${id}-link-url`;
  const linkErrorId = `${id}-link-error`;

  const textLength = summaryTextLength(value);
  const over = textLength > EVENT_SUMMARY_MAX_LENGTH;

  /** 選択を動かさずにコマンドを実行する。使えない環境では何もしない。 */
  const exec = useCallback((command: string, commandValue?: string) => {
    try {
      document.execCommand(command, false, commandValue);
    } catch {
      // 実行できない環境でも本文はそのまま残す。
    }
  }, []);

  /** 今の本文を親へ渡す。 */
  const emit = useCallback(() => {
    const body = bodyRef.current;
    if (body) onChange(body.innerHTML);
  }, [onChange]);

  /** ツールバーの押下状態を、今の選択に合わせる。 */
  const syncPressed = useCallback(() => {
    const body = bodyRef.current;
    const selection = window.getSelection();
    if (!body || !selection || selection.rangeCount === 0) return;
    if (!body.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
    setPressed({
      bold: commandActive("bold"),
      italic: commandActive("italic"),
      underline: commandActive("underline"),
      list: commandActive("insertUnorderedList"),
    });
  }, []);

  // 太字などを `span` の style ではなく `b` で書かせ、段落は `p` にそろえる。
  useEffect(() => {
    exec("styleWithCSS", "false");
    exec("defaultParagraphSeparator", "p");
  }, [exec]);

  // カーソルが動くたびに、押されている書式を追う。
  useEffect(() => {
    document.addEventListener("selectionchange", syncPressed);
    return () => document.removeEventListener("selectionchange", syncPressed);
  }, [syncPressed]);

  // 外部から値が入ったとき（下書きの復元）だけ本文を書き換える。
  // 入力のたびに書き換えると、カーソルが先頭へ飛ぶ。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (body.innerHTML !== value) body.innerHTML = value;
  }, [value]);

  /** 新しいタブで開き、参照元を渡さない。 */
  const normalizeAnchors = () => {
    const body = bodyRef.current;
    if (!body) return;
    body.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer nofollow");
    });
  };

  /** 本文へ焦点を戻す。選択が本文に残っていれば、focus で動かさない。 */
  const focusBody = () => {
    const body = bodyRef.current;
    if (!body) return;
    const selection = window.getSelection();
    const insideBody =
      selection !== null &&
      selection.rangeCount > 0 &&
      body.contains(selection.getRangeAt(0).commonAncestorContainer);
    if (!insideBody) body.focus();
  };

  const runCommand = (command: string) => {
    if (disabled) return;
    focusBody();
    exec(command);
    emit();
    syncPressed();
  };

  /** リンクの入力欄を開く。選択位置と、その位置のリンクを控える。 */
  const openLink = () => {
    if (disabled) return;
    const body = bodyRef.current;
    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    const usable = range && body?.contains(range.commonAncestorContainer) ? range : null;
    savedRange.current = usable;
    savedAnchor.current = usable ? anchorAround(usable.commonAncestorContainer) : null;
    // リンクの中にいれば今の URL を直せる。そうでなければ空から入れる。
    setLinkUrl(savedAnchor.current?.getAttribute("href") ?? "");
    setLinkError(null);
    setLinkOpen(true);
  };

  /** 入れた URL を、控えた選択位置へ反映する。 */
  const applyLink = () => {
    const url = normalizeSummaryLinkUrl(linkUrl);
    if (!url) {
      setLinkError("http または https の URL を入れてください。");
      return;
    }
    const body = bodyRef.current;
    if (!body) return;
    // 入力欄へ移った分の選択を戻す。戻さないと、リンクの付く場所が変わる。
    body.focus();
    const range = savedRange.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const existing = savedAnchor.current;
    if (existing && existing.isConnected) {
      // すでにリンクの上にいるなら、URL だけ差し替える。
      existing.setAttribute("href", url);
    } else if (range && !range.collapsed) {
      exec("createLink", url);
    } else {
      // 何も選んでいなければ、URL そのものをリンクの文字にする。
      exec("insertHTML", `<a href="${escapeAttribute(url)}">${escapeSummaryHtml(url)}</a>`);
    }
    normalizeAnchors();
    emit();
    setLinkOpen(false);
  };

  /** ツールバーの 1 つ。押す前に選択を外さないよう、`mousedown` を止める。 */
  const tool = (
    label: string,
    pressedState: boolean | undefined,
    onClick: () => void,
    content: ReactNode,
  ) => (
    <button
      type="button"
      className="rich-text__tool"
      aria-label={label}
      aria-pressed={pressedState}
      disabled={disabled}
      // 押した瞬間に選択が外れると、書式の対象が消える。外さずに押す。
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {content}
    </button>
  );

  return (
    <>
      <div className={`rich-text${over ? " is-invalid" : ""}`}>
        <div className="rich-text__toolbar" role="toolbar" aria-label="書式">
          {tool(
            "太字",
            pressed.bold,
            () => runCommand("bold"),
            <Bold className="icon" aria-hidden="true" />,
          )}
          {tool(
            "斜体",
            pressed.italic,
            () => runCommand("italic"),
            <Italic className="icon" aria-hidden="true" />,
          )}
          {tool(
            "下線",
            pressed.underline,
            () => runCommand("underline"),
            <Underline className="icon" aria-hidden="true" />,
          )}
          {tool(
            "箇条書き",
            pressed.list,
            () => runCommand("insertUnorderedList"),
            <List className="icon" aria-hidden="true" />,
          )}
          {tool("リンクを入れる", undefined, openLink, <Link2 className="icon" aria-hidden="true" />)}
          {tool("リンクを外す", undefined, () => runCommand("unlink"), <Unlink className="icon" aria-hidden="true" />)}
        </div>
        <div
          ref={bodyRef}
          id={id}
          className="rich-text__body"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="イベント概要"
          aria-invalid={over ? "true" : undefined}
          aria-disabled={disabled ? "true" : undefined}
          aria-describedby={countId}
          data-placeholder={`催しの紹介を${EVENT_SUMMARY_MAX_LENGTH}文字まで書けます`}
          onInput={(event) => {
            // 本文を親の値へ返すだけにする。DOM を書き換えるとカーソルが飛ぶ。
            onChange(event.currentTarget.innerHTML);
            syncPressed();
          }}
          // 貼り付けは文字だけを入れる。ほかの画面の書式や script を持ち込まない。
          // 改行は `escapeSummaryHtml` が `<br>` に変える。
          onPaste={(event) => {
            event.preventDefault();
            if (disabled) return;
            exec("insertHTML", escapeSummaryHtml(event.clipboardData.getData("text/plain")));
            emit();
          }}
          onFocus={syncPressed}
        />
        <p id={countId} className={`rich-text__count${over ? " is-over" : ""}`}>
          {textLength} / {EVENT_SUMMARY_MAX_LENGTH}
        </p>
        <p className="visually-hidden" aria-live="polite">
          {over ? `${EVENT_SUMMARY_MAX_LENGTH}文字を超えています。` : ""}
        </p>
      </div>
      {/* ダイアログは枠の外へ出す。中に入れると、入力中の焦点で枠が強調されたままになる。 */}
      {linkOpen && (
        <Dialog
          title="リンクを入れる"
          titleId={linkTitleId}
          onClose={() => setLinkOpen(false)}
          actions={
            <>
              <button type="button" className="btn btn--primary btn--block" onClick={applyLink}>
                入れる
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setLinkOpen(false)}
              >
                やめる
              </button>
            </>
          }
        >
          <div className="field">
            <label className="label" htmlFor={linkUrlId}>
              URL
            </label>
            <input
              id={linkUrlId}
              className="input"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://example.com"
              value={linkUrl}
              aria-invalid={linkError ? "true" : undefined}
              aria-describedby={linkError ? linkErrorId : undefined}
              onChange={(event) => {
                setLinkUrl(event.target.value);
                setLinkError(null);
              }}
              onKeyDown={(event) => {
                // 入力中の Enter でフォームを送らない。ここでリンクを入れる。
                if (event.key !== "Enter") return;
                // 変換確定の Enter では確定しない。IME の確定を奪わない。
                if (isImeEnter(event)) return;
                event.preventDefault();
                applyLink();
              }}
            />
            {linkError ? (
              <p className="field-error" id={linkErrorId}>
                {linkError}
              </p>
            ) : (
              <p className="help">http または https で始まる URL を入れます。</p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
