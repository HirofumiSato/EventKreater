export interface OutboundSms {
  to: string;
  body: string;
}

export async function deliverSms(message: OutboundSms): Promise<"SENT" | "RECORDED"> {
  const webhook = process.env.SMS_WEBHOOK_URL;
  if (!webhook) {
    console.info(`[sms] ${message.to}: ${message.body}`);
    return "RECORDED";
  }
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (response.ok) return "SENT";
  } catch {
    // 配送先が落ちていても、手元ではコードをログに残して確認を続けられる。
  }
  console.info(`[sms] ${message.to}: ${message.body}`);
  return "RECORDED";
}
