import * as fs from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import * as path from "node:path";
import { MAX_ICON_BYTES } from "../../../core/projects/project-icon.ts";
import type { IconFetcher } from "../../application/icon-resolver.ts";

const LOOPBACK_HOSTS = ["127.0.0.1", "::1"];
const MAX_PAGE_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

// Checked in this order; the first file that exists and is small enough wins.
const FOLDER_ICONS = [
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "src/app/favicon.ico",
  "static/favicon.svg",
  "static/favicon.ico",
  "static/favicon.png",
];

const TYPES_BY_EXTENSION: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

const ICON_LINK = /<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bicon\b[^>]*>/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

type Download = { status: number; type: string; body: Buffer; location: string | null };

/** Reads icons over HTTP and from disk, capped at 64 KB, as `data:image` URLs. */
export class FaviconFetcher implements IconFetcher {
  readonly #timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.#timeoutMs = options.timeoutMs ?? 2000;
  }

  async served(port: number): Promise<string | null> {
    for (const host of LOOPBACK_HOSTS) {
      const base = new URL(`http://${host.includes(":") ? `[${host}]` : host}:${port}/`);
      const icon = await this.#image(new URL("/favicon.ico", base));
      if (icon !== null) return icon;
      const page = await download(new URL("/", base), MAX_PAGE_BYTES, this.#timeoutMs, true);
      if (page === null) continue;
      if (page.status !== 200 || !page.type.startsWith("text/html")) return null;
      for (const href of iconLinks(page.body.toString("utf8"))) {
        if (href.startsWith("data:image/")) return href.length <= MAX_ICON_BYTES * 2 ? href : null;
        const url = new URL(href, base);
        // Only the server's own files: a page may link a CDN, and Studio never calls out for it.
        if (url.origin !== base.origin) continue;
        const linked = await this.#image(url);
        if (linked !== null) return linked;
      }
      return null;
    }
    return null;
  }

  async remote(url: string): Promise<string | null> {
    let current = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") return null;
      const answer = await download(current, MAX_ICON_BYTES, this.#timeoutMs);
      if (answer === null) return null;
      if (answer.location === null) return toDataUrl(answer);
      current = new URL(answer.location, current);
    }
    return null;
  }

  inFolder(rootDir: string): string | null {
    for (const relative of FOLDER_ICONS) {
      const file = path.join(rootDir, relative);
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_ICON_BYTES) continue;
        const type = TYPES_BY_EXTENSION[path.extname(file)] ?? "image/png";
        return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
      } catch {}
    }
    return null;
  }

  async #image(url: URL): Promise<string | null> {
    const answer = await download(url, MAX_ICON_BYTES, this.#timeoutMs);
    return answer === null ? null : toDataUrl(answer);
  }
}

function toDataUrl(answer: Download): string | null {
  if (answer.status !== 200 || !answer.type.startsWith("image/") || answer.body.length === 0) {
    return null;
  }
  return `data:${answer.type};base64,${answer.body.toString("base64")}`;
}

function iconLinks(html: string): string[] {
  const hrefs: string[] = [];
  for (const tag of html.match(ICON_LINK) ?? []) {
    const match = HREF.exec(tag);
    const href = match?.[1] ?? match?.[2] ?? match?.[3];
    if (href) hrefs.push(href.replaceAll("&amp;", "&"));
  }
  return hrefs;
}

/**
 * One GET; null when it fails or times out. A body larger than `maxBytes` is null too, or, with
 * `truncate`, cut there: the icon links of a page sit at its start.
 */
function download(
  url: URL,
  maxBytes: number,
  timeoutMs: number,
  truncate = false,
): Promise<Download | null> {
  return new Promise((resolve) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      url,
      { method: "GET", timeout: timeoutMs, agent: false, headers: { accept: "image/*,*/*" } },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const type = (res.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const location = status >= 300 && status < 400 ? (res.headers.location ?? null) : null;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            if (truncate) chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            resolve(truncate ? { status, type, body: Buffer.concat(chunks), location } : null);
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, type, body: Buffer.concat(chunks), location }));
        res.on("error", () => resolve(null));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.on("close", () => resolve(null));
    req.end();
  });
}
