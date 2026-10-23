"use client";

import { useState } from "react";
import { LineShareDialog } from "@/modules/organizers/components/LineShareDialog";
import { absoluteShareUrl, buildShareText, lineShareUrl } from "@/modules/organizers/lib/share";

interface LineShareButtonProps {
  title: string;
  schedules: readonly { eventDate: string; eventTime: string }[];
  location: string;
  /** 告知ページのパス。絶対 URL は押された時点で origin から組み立てる。 */
  path: string;
  /** ボタンの見た目。既定はアウトライン。 */
  className?: string;
}

/**
 * 告知 URL を、利用者自身の LINE から送るためのボタン。
 * 押すたびに注意書きを出し、同意したときだけ LINE を開く。送信結果は取得できない。
 * デスクトップ版 LINE は URL スキームに対応しないため、表示は CSS でタッチ端末に限る。
 */
export function LineShareButton({
  title,
  schedules,
  location,
  path,
  className,
}: LineShareButtonProps) {
  const [href, setHref] = useState<string | null>(null);

  const openNotice = () => {
    // SSR では window が無いので、絶対 URL は押された時点で作る。
    const url = absoluteShareUrl(path, window.location.origin);
    setHref(lineShareUrl(buildShareText({ title, schedules, location, url })));
  };

  return (
    <>
      <button
        type="button"
        className={["line-share", className ?? "btn btn--outline"].join(" ")}
        onClick={openNotice}
      >
        LINEで送る
      </button>
      {href !== null && <LineShareDialog href={href} onClose={() => setHref(null)} />}
    </>
  );
}
