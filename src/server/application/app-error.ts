import type { ApiErrorCode } from "../../core/api/contract.ts";

/** A failure a user can cause or fix, carried as a value up to the HTTP layer. */
export type AppError = {
  code: ApiErrorCode;
  message: string;
  /** A command the person can run instead, e.g. with sudo. */
  command?: string;
};

export const appError = (code: ApiErrorCode, message: string, command?: string): AppError =>
  command === undefined ? { code, message } : { code, message, command };
