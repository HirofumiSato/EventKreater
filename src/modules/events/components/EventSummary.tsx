"use client";

import { summaryTextLength } from "@/modules/events/lib/summary";

interface EventSummaryProps {
  /** 許可タグだけの HTML。未入力なら null か空文字。 */
  html: string | null | undefined;
}

/* 告知ページの題名直下に置く概要。文字が無ければ欄ごと出さない。
   ここへ届くのは、サーバーで無害化済みの HTML だけである。保存する行は
   zod のスキーマ（`sanitizeEventSummary`）を通し、ライブプレビューも
   ツールバーの出力と plain text の貼り付けしか含まない。 */
export function EventSummary({ html }: EventSummaryProps) {
  if (!html || summaryTextLength(html) === 0) return null;
  return <div className="event-sheet__summary" dangerouslySetInnerHTML={{ __html: html }} />;
}
