import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ProblemDetailException } from "@/lib/exceptions";

export function problemResponse(error: ProblemDetailException, instance?: string): NextResponse {
  return NextResponse.json(error.toBody(instance), {
    status: error.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

export function toErrorResponse(error: unknown, instance?: string): NextResponse {
  if (error instanceof ProblemDetailException) {
    return problemResponse(error, instance);
  }
  if (error instanceof ZodError) {
    return problemResponse(
      new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: error.issues.map((issue) => issue.message).join(" / "),
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
