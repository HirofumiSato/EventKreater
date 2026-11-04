// Cloudflare Worker の入口。env から秘密を読んで handler を作るだけ。

import { createSmsHandler } from "./handler.mjs";

const worker = {
  fetch(request, env) {
    return createSmsHandler({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      from: env.SMS_FROM,
      allowedRecipients: env.ALLOWED_RECIPIENTS,
      webhookToken: env.WEBHOOK_TOKEN,
    })(request);
  },
};

export default worker;
