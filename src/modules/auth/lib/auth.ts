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
  return passwordHashMatches(plain, passwordHash);
}

/**
 * 保存済みのハッシュと照合する。ハッシュが無いときもダミーで同じだけ時間を使う。
 * 「一致したかどうか」だけを見たい場所（登録途中の意向の照合など）はこれを使う。
 * `passwordMatches` はハッシュが無いと常に false になるため、意向の照合には使えない。
 */
export async function passwordHashMatches(plain: string, passwordHash: string | null): Promise<boolean> {
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

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyLocalToken(token: string): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const userId = typeof payload.userId === "string" ? payload.userId : payload.sub;
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!userId || !payload.jti || !SESSION_ID.test(payload.jti)) return null;
    // セッションの失効と退会（論理削除）を 1 往復で確かめる。
    // `include` で user を足すと Prisma は 2 往復になるので、ここだけ 1 文の JOIN で引く。
    // キャッシュは持たない。退会の直後でも、失効したセッションを 1 秒も通さないため。
    const rows = await prisma.$queryRaw<
      { user_id: string; revoked_at: Date | null; expires_at: Date; deleted_at: Date | null }[]
    >`
      SELECT s."user_id", s."revoked_at", s."expires_at", u."deleted_at"
      FROM "auth_sessions" s
      INNER JOIN "users" u ON u."id" = s."user_id"
      WHERE s."id" = ${payload.jti}::uuid
      LIMIT 1
    `;
    const session = rows[0];
    if (
      !session ||
      session.revoked_at !== null ||
      session.expires_at <= new Date() ||
      session.user_id !== userId ||
      session.deleted_at !== null
    ) {
      return null;
    }
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
