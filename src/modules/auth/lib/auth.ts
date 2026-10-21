import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const TOKEN_TTL = "7d";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 会員がいないログインでも bcrypt の所要時間を揃える。 */
const DUMMY_PASSWORD_HASH = "$2a$12$BTxXTNT1Vxx0egct0YOg4Orzf3EJ6vcaSwsgYT0Xve9nLMFEu2v9m";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to a string of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function passwordMatches(plain: string, passwordHash: string | null): Promise<boolean> {
  const hash = passwordHash ?? DUMMY_PASSWORD_HASH;
  const ok = await bcrypt.compare(plain, hash);
  return Boolean(passwordHash) && ok;
}

export async function signLocalToken(payload: AuthTokenPayload): Promise<string> {
  const session = await prisma.authSession.create({
    data: {
      userId: payload.userId,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return new SignJWT({ userId: payload.userId, email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setJti(session.id)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getJwtSecret());
}

export async function verifyLocalToken(token: string): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const userId = typeof payload.userId === "string" ? payload.userId : payload.sub;
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!userId || !payload.jti) return null;
    // 退会（論理削除）した会員のセッションは、失効前に発行されたものでも通さない。
    const session = await prisma.authSession.findUnique({
      where: { id: payload.jti },
      include: { user: { select: { deletedAt: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.userId !== userId) {
      return null;
    }
    if (!session.user || session.user.deletedAt) return null;
    return { userId, email };
  } catch {
    return null;
  }
}

/** JWT の jti（auth_sessions の id）。署名だけを確認し、DB は見ない。 */
export async function readTokenSessionId(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return typeof payload.jti === "string" ? payload.jti : null;
  } catch {
    return null;
  }
}

export async function revokeAuthToken(token: string | null | undefined): Promise<void> {
  if (!token) return;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (!payload.jti) return;
    await prisma.authSession.updateMany({
      where: { id: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    return;
  }
}
