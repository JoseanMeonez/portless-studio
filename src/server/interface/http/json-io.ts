import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiError, ApiErrorCode } from "../../../core/api/contract.ts";
import { err, ok, type Result } from "../../../core/result.ts";

export const MAX_BODY_BYTES = 16 * 1024;

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  invalid_name: 400,
  invalid_port: 400,
  invalid_config: 400,
  forbidden: 403,
  not_found: 404,
  name_taken: 409,
  not_an_alias: 409,
  install_in_progress: 409,
  portless_unavailable: 503,
  install_failed: 502,
  internal: 500,
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

export function sendError(
  res: ServerResponse,
  code: ApiErrorCode,
  message: string,
  status = STATUS_BY_CODE[code],
): void {
  const body: ApiError = { error: code, message };
  sendJson(res, status, body);
}

export type BodyError = "too_large" | "invalid_json";

/** Reads at most `MAX_BODY_BYTES` and parses it as JSON. An empty body reads as `{}`. */
export function readJsonBody(req: IncomingMessage): Promise<Result<unknown, BodyError>> {
  return new Promise((resolve) => {
    const declared = Number(req.headers["content-length"]);
    if (declared > MAX_BODY_BYTES) {
      resolve(err("too_large"));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        resolve(err("too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        resolve(ok({}));
        return;
      }
      try {
        resolve(ok(JSON.parse(text)));
      } catch {
        resolve(err("invalid_json"));
      }
    });
    req.on("error", () => {
      if (done) return;
      done = true;
      resolve(err("invalid_json"));
    });
  });
}
