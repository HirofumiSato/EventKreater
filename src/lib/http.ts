import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ProblemDetailException } from "@/lib/exceptions";

export function problemResponse(error: ProblemDetailException, instance?: string): NextResponse {
  const headers: Record<string, string> = { "Content-Type": "application/problem+json" };
  const retryAfter = error.extras.retryAfterSeconds;
  const retryAt = error.extras.retryAt;
  const limit = error.extras.attemptLimit;
  if (error.status === 429 && typeof retryAfter === "number") {
    headers["Retry-After"] = String(retryAfter);
    if (typeof limit === "number") {
      headers["X-RateLimit-Limit"] = String(limit);
      headers["X-RateLimit-Remaining"] = "0";
    }
    if (typeof retryAt === "string" && !Number.isNaN(Date.parse(retryAt))) {
      headers["X-RateLimit-Reset"] = String(Math.floor(Date.parse(retryAt) / 1000));
    }
  }
  return NextResponse.json(error.toBody(instance), {
    status: error.status,
    headers,
  });
}

export function toErrorResponse(error: unknown, instance?: string): NextResponse {
  if (error instanceof ProblemDetailException) {
    return problemResponse(error, instance);
  }
  if (error instanceof ZodError) {
    // 同じ文言が並ぶと（空の行をいくつも足したときなど）読み手が最初の 1 つを見落とす。
    // 直す場所はパスで分かるので、本文は同じ文言を 1 回だけにする。
    const messages = [...new Set(error.issues.map((issue) => issue.message))];
    return problemResponse(
      new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: messages.join(" / "),
        errors: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }),
      instance,
    );
  }
  console.error(error);
  return problemResponse(
    new ProblemDetailException({
      status: 500,
      title: "Internal Server Error",
      detail: "サーバー内部でエラーが発生しました。",
    }),
    instance,
  );
}

export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
