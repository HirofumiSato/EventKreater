import { createHash } from "crypto";
import { ProblemDetailException } from "@/lib/exceptions";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";

export async function assertPasswordNotBreached(password: string): Promise<void> {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: controller.signal,
    });
    if (!response.ok) return;
    const body = await response.text();
    const leaked = body.split("\n").some((line) => {
      const [candidate, count] = line.trim().split(":");
      return candidate === suffix && Number(count) > 0;
    });
    if (leaked) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "このパスワードは流出が確認されています。別のパスワードを使ってください。",
      });
    }
  } catch (error) {
    if (error instanceof ProblemDetailException) throw error;
    console.error("pwned password check skipped");
  } finally {
    clearTimeout(timer);
  }
}
