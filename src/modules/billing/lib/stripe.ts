import Stripe from "stripe";
import type { NextRequest } from "next/server";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key, { apiVersion: "2023-10-16" });
  }
  return stripeClient;
}

export function stripeExpectsLive(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").includes("_live_");
}

export function stripeResourceId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id || null;
}

export function checkoutIdempotencyKey(req: NextRequest, userId: string, kind: string): string | undefined {
  const raw = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(raw)) return undefined;
  return `${kind}_${userId}_${raw}`.slice(0, 255);
}
