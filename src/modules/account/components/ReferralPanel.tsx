"use client";

import { useEffect, useState } from "react";
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

/**
 * 紹介リンクの配布と実績。
 *
 * 数え上げはサーバー（`/api/v1/user/referral`）が持つ。ここは数を持たず、
 * 開いたときに1回だけ取る。紹介した人が公開するまで枚数は増えないので、
 * 画面を出しっぱなしでも取りこぼしは起きない。
 */
export function ReferralPanel() {
  const [summary, setSummary] = useState<ReferralResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareHref, setShareHref] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/user/referral", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as ReferralResponse) : null))
      .then((body) => {
        if (active) setSummary(body);
      })
      .catch(() => {
        // 取れなくても、この紙を出さないだけで他の操作は続けられる。
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
      <PanelHead title="紹介" note={<>紹介した人が公開すると2枚もらえます</>} />
      <p className="panel__body">このリンクから登録した人が、はじめて公開したときに2枚。</p>
      <div className="ticket-link">
        <input
          className="input"
          readOnly
          value={summary.url}
          aria-label="紹介リンク"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="btn btn--outline btn--sm" onClick={() => void copy()}>
          {copied ? "コピーしました" : "リンクをコピー"}
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
            {summary.granted} / {summary.limit}
          </dd>
        </div>
      </dl>
      <div className="panel__actions">
        <button
          type="button"
          className="line-share btn btn--outline btn--sm"
          onClick={() => setShareHref(lineShareUrl(`紹介リンクです。\n${summary.url}`))}
        >
          LINEで共有
        </button>
      </div>
      {shareHref !== null && <LineShareDialog href={shareHref} onClose={() => setShareHref(null)} />}
    </Panel>
  );
}
