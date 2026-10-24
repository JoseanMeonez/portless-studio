import type { ApiError, ApiErrorCode } from "../../../../core/api/contract.ts";
import type { RouteNameError } from "../../../../core/routes/route-name.ts";

const NAME_MESSAGES: Record<RouteNameError, string> = {
  empty: "Give the port a name.",
  too_long: "That name is too long. Keep it under 253 characters.",
  invalid_label: "Use letters, numbers and hyphens, with dots between parts, like api.myapp.",
};

export const PORT_MESSAGE = "Use a port number from 1 to 65535.";

const API_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  forbidden: "The server refused the change. Reload the page and try again.",
  portless_unavailable: "portless did not answer. Check that it is installed and on your PATH.",
};

export function nameErrorMessage(error: RouteNameError): string {
  return NAME_MESSAGES[error];
}

/**
 * The server's message is usually the most specific; a few codes get a clearer hint instead. A
 * command the person can run themselves, such as one with sudo, is added at the end.
 */
export function apiErrorMessage(error: ApiError): string {
  const message = API_MESSAGES[error.error] ?? error.message;
  return error.command ? `${message} Run: ${error.command}` : message;
}
