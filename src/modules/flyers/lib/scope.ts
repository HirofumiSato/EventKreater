import type { NextRequest } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { resolveAuthContext } from "@/modules/auth/lib/guards";
import type { FlyerQuotaScope } from "@/modules/flyers/lib/quota";

/**
 * 回数を数える単位を決める。
 *
 * 保存済みイベントの枠は共同主催者で共有するため、`eventId` を送る場合は
 * そのイベントの幹事（会員・ゲストのどちらも）であることを確かめる。
 * 他人のイベント ID を指定して枠を消費させたり、残り回数を覗いたりできない。
 */
export async function resolveFlyerQuotaScope(
  req: NextRequest,
  draftKey: string,
  eventId: string | null | undefined,
): Promise<FlyerQuotaScope> {
  if (!eventId) return { draftKey, eventId: null };
  const ctx = await resolveAuthContext(req, eventId);
  if (!ctx.role) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "このイベントの幹事権限がありません。",
    });
  }
  return { draftKey, eventId };
}
