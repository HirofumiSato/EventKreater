import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { cleanup, seedEvent } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * 結合テストでは上限を小さくして、短い手数で境界を確かめる。
 * 上限はモジュールの読み込み時に env から作られるので、読み直してから取り込む。
 */
const IP_LIMIT = 3;
const TOKEN_LIMIT = 2;

type RouteModule = typeof import("@/app/api/v1/public/events/[id]/rsvp/route");

let route: RouteModule;

beforeAll(async () => {
  vi.stubEnv("RSVP_IP_LIMIT", String(IP_LIMIT));
  vi.stubEnv("RSVP_IP_WINDOW_MINUTES", "1");
  vi.stubEnv("RSVP_TOKEN_LIMIT", String(TOKEN_LIMIT));
  vi.stubEnv("RSVP_TOKEN_WINDOW_MINUTES", "10");
  vi.resetModules();
  route = await import("@/app/api/v1/public/events/[id]/rsvp/route");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

interface ProblemBody {
  status: number;
  error?: string;
  limitLabel?: string;
  attemptLimit?: number;
  remainingAttempts?: number;
  retryAfterSeconds?: number;
  retryAt?: string;
}

function url(eventId: string): string {
  return `http://localhost/api/v1/public/events/${eventId}/rsvp`;
}

/** 出欠の POST。Cookie を渡さなければ、毎回新しい端末として扱われる。 */
function post(
  eventId: string,
  input: { ip: string; token?: string; name?: string },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cf-connecting-ip": input.ip,
  };
  if (input.token) headers.cookie = `rsvp_token_${eventId}=${input.token}`;
  return route.POST(
    new NextRequest(url(eventId), {
      method: "POST",
      headers,
      // 欠席なら日時と費用プランを選ばなくてよい（上限だけを見るため）。
      body: JSON.stringify({ name: input.name ?? "参加者", status: "DECLINED" }),
    }),
    { params: { id: eventId } },
  );
}

function remove(eventId: string, input: { ip: string; token: string }) {
  return route.DELETE(
    new NextRequest(url(eventId), {
      method: "DELETE",
      headers: {
        "cf-connecting-ip": input.ip,
        cookie: `rsvp_token_${eventId}=${input.token}`,
      },
    }),
    { params: { id: eventId } },
  );
}

/** 使ったイベントのバケットを消す。キーは `<接頭辞><eventId>:<hash>`。 */
async function dropBuckets(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const prefixes = eventIds.flatMap((eventId) => [
    `rsvp:ip:${eventId}:`,
    `rsvp:token:${eventId}:`,
  ]);
  await prisma.authAttempt.deleteMany({
    where: { OR: prefixes.map((prefix) => ({ bucket: { startsWith: prefix } })) },
  });
}

describeDb("出欠の回数制限（結合）", () => {
  const eventIds: string[] = [];

  afterEach(async () => {
    await dropBuckets(eventIds);
    await cleanup({ eventIds, userIds: [] });
    eventIds.length = 0;
  });

  it("上限に達すると 429 になり、再試行の時刻を返す", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    const ip = "203.0.113.10";

    for (let index = 0; index < IP_LIMIT; index += 1) {
      expect((await post(event.id, { ip })).status).toBe(201);
    }

    const response = await post(event.id, { ip });
    expect(response.status).toBe(429);
    const body = (await response.json()) as ProblemBody;
    expect(body.status).toBe(429);
    expect(body.error).toBe("RATE_LIMITED");
    expect(body.limitLabel).toBe("この催しへの出欠の回答");
    expect(body.attemptLimit).toBe(IP_LIMIT);
    expect(body.remainingAttempts).toBe(0);
    expect(typeof body.retryAfterSeconds).toBe("number");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(typeof body.retryAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.retryAt ?? ""))).toBe(false);
    expect(response.headers.get("Retry-After")).toBe(String(body.retryAfterSeconds));
    expect(response.headers.get("X-RateLimit-Limit")).toBe(String(IP_LIMIT));
  });

  it("イベント ID が違えば独立して数える", async () => {
    const first = await seedEvent();
    const second = await seedEvent();
    eventIds.push(first.id, second.id);
    const ip = "203.0.113.20";

    for (let index = 0; index < IP_LIMIT; index += 1) {
      expect((await post(first.id, { ip })).status).toBe(201);
    }
    expect((await post(first.id, { ip })).status).toBe(429);

    // 同じ接続元でも、別の催しの枠は減っていない。
    expect((await post(second.id, { ip })).status).toBe(201);
  });

  it("端末のバケットは接続元とは別に効く", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    const cookieName = `rsvp_token_${event.id}`;
    // 端末の枠だけを見るため、接続元は毎回変えて IP の枠に当たらないようにする。
    const ips = ["203.0.113.31", "203.0.113.32", "203.0.113.33", "203.0.113.34"];

    // 1 回目は Cookie を持たない。発行された端末トークンを以後のリクエストで使う。
    const created = await post(event.id, { ip: ips[0] });
    expect(created.status).toBe(201);
    const token = created.cookies.get(cookieName)?.value;
    expect(token).toBeTruthy();

    expect((await post(event.id, { ip: ips[1], token })).status).toBe(200);
    expect((await post(event.id, { ip: ips[2], token })).status).toBe(200);

    const limited = await post(event.id, { ip: ips[3], token });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as ProblemBody;
    expect(body.limitLabel).toBe("この端末からの出欠の回答");
    expect(body.attemptLimit).toBe(TOKEN_LIMIT);

    // 別の端末は、IP の枠が残っていれば通る。
    expect((await post(event.id, { ip: "203.0.113.35", token: "another-token" })).status).toBe(201);
  });

  it("DELETE は POST と同じ IP のバケットを消費する", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    const ip = "203.0.113.40";
    const cookieName = `rsvp_token_${event.id}`;

    const created = await post(event.id, { ip });
    expect(created.status).toBe(201);
    const token = created.cookies.get(cookieName)?.value;
    expect(token).toBeTruthy();

    // POST（1 回目）と DELETE（2 回目）で、IP の枠は 2 回ぶん減る。
    expect((await remove(event.id, { ip, token: token as string })).status).toBe(200);
    expect((await post(event.id, { ip })).status).toBe(201);

    // DELETE が数えられていなければ、ここはまだ通る。
    expect((await post(event.id, { ip })).status).toBe(429);
  });
});
