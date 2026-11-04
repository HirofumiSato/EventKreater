export interface OutboundSms {
  to: string;
  body: string;
}

/**
 * ログに出す宛先。`+` と桁の見当だけを残し、真ん中を伏せる。
 * 例: `+819012345678` -> `+8190****5678`
 */
function maskDestination(to: string): string {
  const plus = to.startsWith("+") ? "+" : "";
  const digits = to.slice(plus.length);
  if (digits.length <= 8) return `${plus}****`;
  return `${plus}${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

export async function deliverSms(message: OutboundSms): Promise<"SENT" | "RECORDED"> {
  // 本番のログは Fly に残り続けるので、6 桁コード（本文）を絶対に出さない。
  // ローカルとテストでは、届いたかをログで確かめられるよう本文を出してよい。
  const isProduction = process.env.NODE_ENV === "production";
  const webhook = process.env.SMS_WEBHOOK_URL;
  if (!webhook) {
    if (isProduction) {
      // 未設定のまま動くと、コードを本文に残して未送信になる。宛先だけを伏せて知らせる。
      console.warn(`[sms] SMS_WEBHOOK_URL が未設定です ${maskDestination(message.to)}`);
    } else {
      console.info(`[sms] ${message.to}: ${message.body}`);
    }
    return "RECORDED";
  }
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (response.ok) return "SENT";
    if (isProduction) {
      console.warn(`[sms] 送信に失敗しました (HTTP ${response.status}) ${maskDestination(message.to)}`);
    }
  } catch {
    // 中継が落ちていても登録は止めない。本番では理由とマスクした宛先だけを残す。
    if (isProduction) {
      console.warn(`[sms] 送信に失敗しました (network) ${maskDestination(message.to)}`);
    }
  }
  if (!isProduction) console.info(`[sms] ${message.to}: ${message.body}`);
  return "RECORDED";
}
