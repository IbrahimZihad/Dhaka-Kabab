/** Typed application errors. HTTP layer maps `code` to a status; UI maps it to a message. */

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "TABLE_INACTIVE"
  | "SESSION_CLOSED"
  | "ITEM_UNAVAILABLE"
  | "INVALID_TRANSITION"
  | "PAYMENT_UNVERIFIED"
  | "PAYMENT_DUPLICATE"
  | "PROVIDER_NOT_CONFIGURED"
  | "UNAVAILABLE";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  TABLE_INACTIVE: 409,
  SESSION_CLOSED: 409,
  ITEM_UNAVAILABLE: 409,
  INVALID_TRANSITION: 400,
  PAYMENT_UNVERIFIED: 402,
  PAYMENT_DUPLICATE: 409,
  PROVIDER_NOT_CONFIGURED: 503,
  UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Field-level problems for form rendering; never contains stored values. */
  readonly details?: Record<string, string[]>;

  constructor(code: ErrorCode, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Anything that reaches a client without being an AppError is logged, never echoed. */
export function toPublicError(error: unknown): { code: ErrorCode; message: string; status: number } {
  if (isAppError(error)) {
    return { code: error.code, message: error.message, status: error.status };
  }
  console.error("[unhandled]", error);
  return {
    code: "UNAVAILABLE",
    message: "Something went wrong on our side. Please try again or ask a staff member.",
    status: 500,
  };
}
