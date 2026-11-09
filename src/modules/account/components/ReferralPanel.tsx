"use client";

import { useEffect, useRef, useState } from "react";
import { LineShareDialog } from "@/modules/organizers/components/LineShareDialog";
import { lineShareUrl } from "@/modules/organizers/lib/share";
import { Panel, PanelHead } from "@/components/ui";

interface ReferralResponse {
  code: string;
  url: string;
  invited: number;
  granted: number;
  limit: number;
}

type ReferralPanelProps = {
  /**
   * 紹介の取得が終わった（成功・失敗のどちらでも 1 回）。
   * 操作ガイドは、この紙の高さが決まってから対象を測る。
   */
  onReady?: () => void;
};

/**
 * 紹介リンクの配布と実績。
 *
 * 数え上げはサーバー（`/api/v1/user/referral`）が持つ。ここは数を持たず、
 * 開いたときに1回だけ取る。紹介した人が公開するまで枚数は増えないので、
 * 画面を出しっぱなしでも取りこぼしは起きない。
 */
export function ReferralPanel({ onReady }: ReferralPanelProps) {
  const [summary, setSummary] = useState<ReferralResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareHref, setShareHref] = useState<string | null>(null);
  // 親は描画のたびに新しい関数を渡しうる。依存配列を増やさず、最新の 1 つだけを ref で持つ。
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/user/referral", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as ReferralResponse) : null))
      .then((body) => {
        if (active) setSummary(body);
      })
      .catch(() => {
        // 取れなくても、この紙を出さないだけで他の操作は続けられる。
      })
      .finally(() => {
        // 成功・失敗のどちらでも、取得が終わったことを 1 回だけ知らせる。
        if (active) onReadyRef.current?.();
      });
    return () => {
      active = false;
    };
  }, []);

  if (!summary) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードを使えない端末では、入力欄を選んで手で写してもらう。
    }
  };

  return (
    <Panel>
      <PanelHead title="紹介" />
      <p className="panel__body">
        このリンクから登録した人が初めてイベント公開すると、無料チケットを2枚もらえます。
        <span className="panel__note--limit">※1アカウント当たり上限10枚</span>
      </p>
      <div className="ticket-link">
        <input
          className="input"
          readOnly
          value={summary.url}
          aria-label="紹介リンク"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="btn btn--outline btn--sm" onClick={() => void copy()}>
          {copied ? "コピーしました" : "紹介リンクをコピー"}
        </button>
      </div>
      <dl className="kv">
        <div className="kv__row">
          <dt>紹介した人</dt>
          <dd>{summary.invited}人</dd>
        </div>
        <div className="kv__row">
          <dt>もらった枚数</dt>
          <dd>
            {summary.granted}枚 / {summary.limit}枚
          </dd>
        </div>
      </dl>
      <div className="panel__actions">
        <button
          type="button"
          className="line-share btn btn--outline btn--sm"
          onClick={() => setShareHref(lineShareUrl(`紹介リンクです。\n${summary.url}`))}
        >
          招待リンクをLINEで送る
        </button>
      </div>
      {shareHref !== null && (
        <LineShareDialog
          href={shareHref}
          onClose={() => setShareHref(null)}
          title="LINEで招待リンクを送る"
          hint="LINE画面で「共有」を押すと、紹介リンクが送られます。確認モーダルは出ません。"
        />
      )}
    </Panel>
  );
}
