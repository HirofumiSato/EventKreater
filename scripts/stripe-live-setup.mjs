/**
 * Stripe の本番（live）リソースを、再実行しても壊れない形で作る。
 *
 *   node scripts/stripe-live-setup.mjs            # 作る（既定は setup）
 *   node scripts/stripe-live-setup.mjs setup --dry-run
 *   node scripts/stripe-live-setup.mjs verify     # 読むだけ
 *
 * `.env` は読まない。`sk_live_` を `.env` に置かない規則（docs/stripe.rst）があるため、
 * 秘密鍵はシェルの環境変数から受ける。
 *
 *   $env:STRIPE_SECRET_KEY = "sk_live_..."
 *   $env:NEXT_PUBLIC_APP_URL = "https://eventkreater.com"
 *   npm run stripe:setup -- --dry-run
 *
 * 金額の正はアプリ自身の公開 API（GET /api/v1/public/pricing）。plans.ts の値を
 * ここへ写すと、値上げのときに片方だけ直して静かにずれる。
 */
import Stripe from "stripe";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
const SECRET = process.env.STRIPE_SECRET_KEY ?? "";

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("-")) ?? "setup";
const dryRun = args.includes("--dry-run");
const allowTest = args.includes("--allow-test");
const rotateWebhookSecret = args.includes("--rotate-webhook-secret");

/** Webhook で受けるイベント。webhook/route.ts の switch と揃える。 */
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
];

/** アプリ側の呼び名と、Price の lookup key の対応。 */
const PLANS = [
  { plan: "MONTHLY_8", priceEnv: "STRIPE_PRICE_ID_MONTHLY_8", lookupKey: "eventkreater_monthly_8", pricingKey: "subscription8", recurring: true },
  { plan: "UNLIMITED", priceEnv: "STRIPE_PRICE_ID_UNLIMITED", lookupKey: "eventkreater_unlimited", pricingKey: "subscriptionUnlimited", recurring: true },
  { plan: "ONE_TIME", priceEnv: "STRIPE_PRICE_ID_ONE_TIME", lookupKey: "eventkreater_one_time", pricingKey: "oneTime", recurring: false },
];

const PRODUCT_NAMES = {
  MONTHLY_8: "EventKreater 8件まで公開プラン",
  UNLIMITED: "EventKreater 公開し放題プラン",
  ONE_TIME: "EventKreater 単発チケット",
};

if (!SECRET) {
  fail("STRIPE_SECRET_KEY がありません。シェルの環境変数で渡してください（.env には置かない）。");
}
if (!APP_URL) {
  fail("NEXT_PUBLIC_APP_URL がありません。例: https://eventkreater.com");
}

const isLive = SECRET.includes("_live_");
if (!isLive && command === "setup" && !allowTest) {
  fail(
    [
      "STRIPE_SECRET_KEY が本番の鍵ではありません。",
      "テストモードで試すときだけ --allow-test を付けてください。",
      "本番の手順は docs/deploy.rst の「4. Stripe を本番に向ける」にあります。",
    ].join("\n"),
  );
}

const stripe = new Stripe(SECRET, { apiVersion: "2023-10-16" });

function fail(message) {
  console.error(`\n[stripe:setup] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[stripe:setup] ${message}`);
}

/** アプリが表示している定価。ここを正にして Stripe 側と突き合わせる。 */
async function loadPrices() {
  const url = `${APP_URL}/api/v1/public/pricing`;
  const response = await fetch(url);
  if (!response.ok) {
    fail(`${url} が ${response.status} を返しました。先にデプロイと DATABASE_URL を確かめてください。`);
  }
  const body = await response.json();
  const pricing = body?.pricing;
  if (!pricing) fail(`${url} の応答に pricing がありません。`);
  return {
    oneTime: pricing.oneTime?.listPrice,
    subscription8: pricing.subscription8?.listPrice,
    subscriptionUnlimited: pricing.subscriptionUnlimited?.listPrice,
  };
}

async function findProduct(plan) {
  // products.search は反映が遅れることがあるので、一覧から引く（数は 3 つ）。
  const list = await stripe.products.list({ limit: 100, active: true });
  return list.data.find((product) => product.metadata?.eventkreaterPlan === plan) ?? null;
}

async function ensureProduct(plan) {
  const existing = await findProduct(plan);
  if (existing) {
    log(`Product ${plan} は既にあります (${existing.id})`);
    return existing;
  }
  if (dryRun) {
    log(`[dry-run] Product ${plan} を作ります（${PRODUCT_NAMES[plan]}）`);
    return { id: `prod_dry_${plan}` };
  }
  const created = await stripe.products.create({
    name: PRODUCT_NAMES[plan],
    metadata: { eventkreaterPlan: plan },
  });
  log(`Product ${plan} を作りました (${created.id})`);
  return created;
}

function matchesRecurring(price, recurring) {
  if (!recurring) return price.recurring === null;
  return price.recurring?.interval === "month";
}

async function findPriceByLookupKey(lookupKey) {
  const list = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
  return list.data[0] ?? null;
}

async function ensurePrice(spec, product, amount) {
  const existing = await findPriceByLookupKey(spec.lookupKey);
  if (
    existing &&
    existing.unit_amount === amount &&
    existing.currency === "jpy" &&
    existing.product === product.id &&
    matchesRecurring(existing, spec.recurring)
  ) {
    log(`Price ${spec.plan} は既にあります (${existing.id}, ${amount} 円)`);
    return existing;
  }

  // 金額か周期が変わっている。古い Price の lookup key を外してから作る。
  if (existing && !dryRun) {
    await stripe.prices.update(existing.id, { lookup_key: "", active: false });
    log(`Price ${spec.plan} の古い Price を止めました (${existing.id})`);
  }

  if (dryRun) {
    log(`[dry-run] Price ${spec.plan} を作ります（${amount} 円${spec.recurring ? " / 月" : ""}）`);
    return { id: `price_dry_${spec.plan}` };
  }

  const created = await stripe.prices.create({
    product: product.id,
    currency: "jpy",
    unit_amount: amount,
    lookup_key: spec.lookupKey,
    ...(spec.recurring ? { recurring: { interval: "month" } } : {}),
  });
  log(`Price ${spec.plan} を作りました (${created.id}, ${amount} 円)`);
  return created;
}

async function ensureWebhookEndpoint() {
  const url = `${APP_URL}/api/v1/webhooks/stripe`;
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = list.data.find((endpoint) => endpoint.url === url);

  if (existing && !rotateWebhookSecret) {
    const missing = WEBHOOK_EVENTS.filter((event) => !existing.enabled_events.includes(event));
    if (missing.length > 0 && !dryRun) {
      await stripe.webhookEndpoints.update(existing.id, {
        enabled_events: WEBHOOK_EVENTS,
      });
      log(`Webhook のイベントを揃えました (${existing.id})`);
    }
    log(`Webhook は既にあります (${existing.id})`);
    log(
      "署名シークレットは API から取り出せません。値が分からないときは Dashboard で Roll するか、" +
        "--rotate-webhook-secret を付けて作り直してください。",
    );
    return { id: existing.id, secret: null };
  }

  if (existing && rotateWebhookSecret) {
    if (dryRun) {
      log(`[dry-run] Webhook ${existing.id} を削除して作り直します`);
      return { id: `we_dry`, secret: null };
    }
    await stripe.webhookEndpoints.del(existing.id);
    log(`古い Webhook を削除しました (${existing.id})`);
  }

  if (dryRun) {
    log(`[dry-run] Webhook を作ります（${url}）`);
    return { id: "we_dry", secret: "whsec_dry_run" };
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: "EventKreater 本番",
  });
  log(`Webhook を作りました (${created.id})`);
  return { id: created.id, secret: created.secret ?? null };
}

/**
 * Customer Portal の「既定の設定」。
 * src/app/api/v1/billing/portal/route.ts は configuration を渡さないので、
 * is_default の 1 本がそのまま使われる。test モードの設定は live に引き継がれない。
 */
async function ensurePortalConfiguration(products) {
  const list = await stripe.billingPortal.configurations.list({ limit: 100 });
  const existing = list.data.find((configuration) => configuration.is_default);

  const payload = {
    business_profile: {
      headline: "EventKreater",
      privacy_policy_url: `${APP_URL}/privacy`,
      terms_of_service_url: `${APP_URL}/terms`,
    },
    default_return_url: `${APP_URL}/organizer/events`,
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        // 利用規約 第3条「日割りでの精算は行いません」に合わせる。
        proration_behavior: "none",
        products: products.map(({ productId, priceId }) => ({
          product: productId,
          prices: [priceId],
        })),
      },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "shipping"] },
    },
  };

  if (dryRun) {
    log(existing ? `[dry-run] Portal の既定 (${existing.id}) を更新します` : "[dry-run] Portal の既定を作ります");
    return existing?.id ?? "bpc_dry";
  }

  if (existing) {
    await stripe.billingPortal.configurations.update(existing.id, payload);
    log(`Portal の既定を更新しました (${existing.id})`);
    return existing.id;
  }

  const created = await stripe.billingPortal.configurations.create({
    ...payload,
    is_default: true,
  });
  log(`Portal の既定を作りました (${created.id})`);
  return created.id;
}

async function setup() {
  log(`対象: ${APP_URL}（${isLive ? "live" : "test"}）${dryRun ? " / dry-run" : ""}`);
  const prices = await loadPrices();
  log(
    `アプリの定価: 単発 ${prices.oneTime} 円 / 8件 ${prices.subscription8} 円 / し放題 ${prices.subscriptionUnlimited} 円`,
  );

  const resolved = [];
  for (const spec of PLANS) {
    const amount = prices[spec.pricingKey];
    if (typeof amount !== "number" || amount < 0) {
      fail(`${spec.plan} の定価を公開 API から読めませんでした。`);
    }
    const product = await ensureProduct(spec.plan);
    const price = await ensurePrice(spec, product, amount);
    resolved.push({ ...spec, productId: product.id, priceId: price.id, amount });
  }

  const webhook = await ensureWebhookEndpoint();
  await ensurePortalConfiguration(resolved);

  console.log("\n--- 次の 1 行を実行して Fly の秘密を差し替えてください ---\n");
  // 秘密鍵そのものは画面に出さない（PowerShell が実行時に展開する）。
  // Webhook の署名は作りたてしか取り出せないので、ここだけは 1 度だけ表示する。
  const env = [
    `STRIPE_SECRET_KEY="$env:STRIPE_SECRET_KEY"`,
    webhook.secret
      ? `STRIPE_WEBHOOK_SECRET="${webhook.secret}"`
      : `STRIPE_WEBHOOK_SECRET="<Dashboard で Roll した値>"`,
    ...resolved.map(({ priceEnv, priceId }) => `${priceEnv}="${priceId}"`),
  ];
  console.log(`fly secrets set ${env.join(" ")} --app event-creater-web`);
  if (webhook.secret) {
    console.log("\nWebhook の署名は、この表示が最後です。Dashboard の Roll 以外では取り出せません。");
  }
  console.log(
    "\nSTRIPE_PRICE_ID_MONTHLY_980_LEGACY は空のままにしてください（値上げ前の既存契約の検証用）。",
  );
  console.log("差し替えたあと、npm run stripe:setup -- verify で確かめられます。");
}

async function verify() {
  log(`確認: ${APP_URL}（${isLive ? "live" : "test"}）`);
  const problems = [];
  const prices = await loadPrices();
  const list = await stripe.products.list({ limit: 100, active: true });

  for (const spec of PLANS) {
    const product = list.data.find((item) => item.metadata?.eventkreaterPlan === spec.plan);
    if (!product) {
      problems.push(`Product ${spec.plan} がありません`);
      continue;
    }
    const price = await findPriceByLookupKey(spec.lookupKey);
    if (!price) {
      problems.push(`Price ${spec.plan}（${spec.lookupKey}）がありません`);
      continue;
    }
    const amount = prices[spec.pricingKey];
    if (price.unit_amount !== amount) {
      problems.push(`Price ${spec.plan} が ${price.unit_amount} 円で、アプリの ${amount} 円と違います`);
    }
    if (!matchesRecurring(price, spec.recurring)) {
      problems.push(`Price ${spec.plan} の周期が違います`);
    }
    const envValue = process.env[spec.priceEnv];
    if (envValue && envValue !== price.id) {
      problems.push(`${spec.priceEnv} が ${envValue} を指しています（正は ${price.id}）`);
    }
    if (!envValue) {
      log(`未設定: ${spec.priceEnv} は ${price.id} にすると揃います`);
    }
  }

  const webhook = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(
    (endpoint) => endpoint.url === `${APP_URL}/api/v1/webhooks/stripe`,
  );
  if (!webhook) {
    problems.push("Webhook のエンドポイントがありません");
  } else {
    const missing = WEBHOOK_EVENTS.filter((event) => !webhook.enabled_events.includes(event));
    if (missing.length > 0) problems.push(`Webhook に ${missing.join(", ")} が足りません`);
    if (webhook.status !== "enabled") problems.push(`Webhook の状態が ${webhook.status} です`);
  }

  const portal = (await stripe.billingPortal.configurations.list({ limit: 100 })).data.find(
    (configuration) => configuration.is_default,
  );
  if (!portal) {
    problems.push("Customer Portal の既定の設定がありません");
  } else {
    const update = portal.features?.subscription_update;
    if (!update?.enabled) problems.push("Portal でプラン変更が無効です");
    if (update?.proration_behavior !== "none") {
      problems.push("Portal の日割り計算が none ではありません（利用規約と食い違います）");
    }
    const portalPrices = (update?.products ?? []).flatMap((entry) =>
      (entry.prices ?? []).map((price) => (typeof price === "string" ? price : price.id)),
    );
    for (const spec of PLANS.filter((item) => item.recurring)) {
      const price = await findPriceByLookupKey(spec.lookupKey);
      if (price && !portalPrices.includes(price.id)) {
        problems.push(`Portal のプラン変更に ${spec.plan} の Price がありません`);
      }
    }
    if (portal.features?.subscription_cancel?.mode !== "at_period_end") {
      problems.push("Portal の解約が「期間終了時」になっていません");
    }
  }

  if (problems.length > 0) {
    console.error("");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  log("問題ありません。");
}

try {
  if (command === "verify") await verify();
  else if (command === "setup") await setup();
  else fail(`知らないサブコマンドです: ${command}（setup か verify）`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
}
