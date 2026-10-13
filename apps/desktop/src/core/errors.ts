// Error shape shared by the local API and the services behind it. Codes and statuses follow
// JobPilot's API, so the ported agent skills read failures the same way.

export const ErrorCodes = {
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  UNPROCESSABLE: "UNPROCESSABLE_ENTITY",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL_ERROR",
} as const;

export class HttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(ErrorCodes.INVALID_REQUEST, message, 400, details);
export const notFound = (message = "Not found") => new HttpError(ErrorCodes.NOT_FOUND, message, 404);
export const conflict = (message: string) => new HttpError(ErrorCodes.CONFLICT, message, 409);
export const forbidden = (message: string) => new HttpError(ErrorCodes.FORBIDDEN, message, 403);
export const unauthorized = (message = "Unauthorized") =>
  new HttpError(ErrorCodes.UNAUTHORIZED, message, 401);
export const unprocessable = (message = "Invalid request", details?: unknown) =>
  new HttpError(ErrorCodes.UNPROCESSABLE, message, 422, details);
export const tooManyRequests = (message: string) =>
  new HttpError(ErrorCodes.RATE_LIMITED, message, 429);
