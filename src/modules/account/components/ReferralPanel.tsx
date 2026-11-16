"use client";

import { useEffect, useRef, useState } from "react";
import { LineShareDialog } from "@/modules/organizers/components/LineShareDialog";
import { lineShareUrl } from "@/modules/organizers/lib/share";
import type { ReferralSummary } from "@/modules/billing/lib/referral";
import { Panel, PanelHead } from "@/components/ui";

type ReferralPanelProps = {
  /**
   * サーバーで読んだ紹介リンクと実績。マイページのサーバーコンポーネントが渡す。
   * 読めなかったときは null で、紙を出さない（他の操作は続けられる）。
   */
  initial: ReferralSummary | null;
  /**
   * 紙を描き終えた（出さないときも 1 回）。
   * 操作ガイドは、この紙の高さが決まってから対象を測る。
   */
  onReady?: () => void;
};

/**
 * 紹介リンクの配布と実績。
 *
 * 数え上げはサーバー（`/api/v1/user/referral` と `loadReferralSummary`）が持つ。
 * ここは数を持たず、渡された初期値をそのまま描く。紹介した人が公開するまで
 * 枚数は増えないので、画面を出しっぱなしでも取りこぼしは起きない。
 */
export function ReferralPanel({ initial, onReady }: ReferralPanelProps) {
  const [copied, setCopied] = useState(false);
  const [shareHref, setShareHref] = useState<string | null>(null);
  // 親は描画のたびに新しい関数を渡しうる。依存配列を増やさず、最新の 1 つだけを ref で持つ。
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    // 紙は最初の HTML に載っているので、測れるようになった時点で 1 回だけ知らせる。
    onReadyRef.current?.();
  }, []);

  // サーバーで読めなかったときは、取れなかった今までと同じく紙を出さない。
  if (!initial) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(initial.url);
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
          value={initial.url}
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
          <dd>{initial.invited}人</dd>
        </div>
        <div className="kv__row">
          <dt>もらった枚数</dt>
          <dd>
            {initial.granted}枚 / {initial.limit}枚
          </dd>
        </div>
      </dl>
      <div className="panel__actions">
        <button
          type="button"
          className="line-share btn btn--outline btn--sm"
          onClick={() => setShareHref(lineShareUrl(`紹介リンクです。\n${initial.url}`))}
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
