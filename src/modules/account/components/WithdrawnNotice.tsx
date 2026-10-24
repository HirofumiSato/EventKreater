"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";

/**
 * 退会直後にトップへ戻したときの案内。
 * 退会するとセッションが消えるため、画面遷移ではなくクエリで結果だけを伝える。
 */
export function WithdrawnNotice() {
  const [withdrawn, setWithdrawn] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setWithdrawn(params.get("withdrawn") === "1");
  }, []);

  if (!withdrawn) return null;

  return (
    <Alert tone="info">
      退会が完了しました。ご利用ありがとうございました。同じ電話番号で登録し直すと、以前のアカウントを引き継ぎます。
    </Alert>
  );
}
