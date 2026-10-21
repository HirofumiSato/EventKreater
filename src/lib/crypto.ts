import { createHash, randomBytes } from "crypto";
import { nanoid } from "nanoid";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

export function generateNanoId(size = 21): string {
  return nanoid(size);
}
