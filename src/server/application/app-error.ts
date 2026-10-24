import type { ApiErrorCode } from "../../core/api/contract.ts";

/** A failure a user can cause or fix, carried as a value up to the HTTP layer. */
export type AppError = {
  code: ApiErrorCode;
  message: string;
};

export const appError = (code: ApiErrorCode, message: string): AppError => ({ code, message });
