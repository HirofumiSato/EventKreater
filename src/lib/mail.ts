export interface OutboundMail {
  to: string;
  subject: string;
  body: string;
}

/** 配送が記録に留まったときだけ本文をログへ残す。本番では出さない。 */
export function logRecordedMail(line: string): void {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[mail] ${line}`);
}

export async function deliverMail(message: OutboundMail): Promise<"SENT" | "RECORDED"> {
  const webhook = process.env.MAIL_WEBHOOK_URL;
  if (!webhook) return "RECORDED";
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    return response.ok ? "SENT" : "RECORDED";
  } catch {
    return "RECORDED";
  }
}
