import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { resolveUserId } from "@/modules/auth/lib/guards";
import { FLYER_OWNER_COOKIE, FLYER_OWNER_MAX_AGE, writeCookie } from "@/modules/auth/lib/cookies";

export async function flyerOwnerFilter(req: NextRequest): Promise<Prisma.FlyerAssetWhereInput | null> {
  const userId = await resolveUserId(req);
  const raw = req.cookies.get(FLYER_OWNER_COOKIE)?.value;
  const clauses: Prisma.FlyerAssetWhereInput[] = [];
  if (userId) clauses.push({ userId });
  if (raw) clauses.push({ ownerTokenHash: sha256(raw) });
  if (clauses.length === 0) return null;
  return { isDeleted: false, OR: clauses };
}

export async function resolveFlyerOwner(req: NextRequest): Promise<{
  userId: string | null;
  rawToken: string;
  ownerTokenHash: string;
  issueCookie: boolean;
}> {
  const userId = await resolveUserId(req);
  const existing = req.cookies.get(FLYER_OWNER_COOKIE)?.value;
  const rawToken = existing || generateSecureToken(32);
  return {
    userId,
    rawToken,
    ownerTokenHash: sha256(rawToken),
    issueCookie: !existing,
  };
}

export function writeFlyerOwnerCookie(response: NextResponse, req: NextRequest, rawToken: string): void {
  writeCookie(response, req, FLYER_OWNER_COOKIE, rawToken, FLYER_OWNER_MAX_AGE);
}
