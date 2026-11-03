// Cloudflare Worker の入口。env から秘密を読んで handler を作るだけ。

import { createMailHandler } from "./handler.mjs";

const worker = {
  fetch(request, env) {
    return createMailHandler({
      resendApiKey: env.RESEND_API_KEY,
      from: env.MAIL_FROM,
      allowedRecipients: env.ALLOWED_RECIPIENTS,
      webhookToken: env.WEBHOOK_TOKEN,
      // staging は wrangler.toml、本番は wrangler.prod.toml で決める。未設定なら空。
      subjectPrefix: env.SUBJECT_PREFIX,
    })(request);
  },
};

export default worker;
