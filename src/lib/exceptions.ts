export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  [key: string]: unknown;
}

const TYPE_BY_STATUS: Record<number, string> = {
  400: "probs/validation-error",
  401: "probs/unauthorized",
  402: "probs/quota-exceeded",
  403: "probs/forbidden",
  404: "probs/not-found",
  409: "probs/lock-conflict",
  422: "probs/validation-error",
  429: "probs/rate-limit",
  502: "probs/bad-gateway",
  500: "probs/internal-error",
};

export class ProblemDetailException extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly type: string;
  readonly extras: Record<string, unknown>;

  constructor(input: {
    status: number;
    title: string;
    detail: string;
    type?: string;
    [key: string]: unknown;
  }) {
    super(input.detail);
    this.name = "ProblemDetailException";
    this.status = input.status;
    this.title = input.title;
    this.detail = input.detail;
    this.type = input.type ?? TYPE_BY_STATUS[input.status] ?? "probs/internal-error";
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "status" || key === "title" || key === "detail" || key === "type") continue;
      extras[key] = value;
    }
    this.extras = extras;
  }

  toBody(instance?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      ...(instance ? { instance } : {}),
      ...this.extras,
    };
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
