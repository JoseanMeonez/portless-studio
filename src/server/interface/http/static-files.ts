import * as fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".svg", ".txt"]);
const MIN_COMPRESS_BYTES = 1024;

/** No inline scripts, no third parties, never framed. Vite builds need nothing more. */
const HTML_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

type Encoding = "br" | "gzip";

type CachedFile = {
  version: string;
  raw: Buffer;
  encoded: Partial<Record<Encoding, Buffer>>;
};

/**
 * Serves the built web app. Hashed files under `/assets/` are cached forever; `index.html` is
 * revalidated so a new build shows up on reload. Unknown paths without an extension fall back to
 * `index.html` so client-side routes load.
 */
export class StaticFiles {
  readonly #root: string;
  readonly #cache = new Map<string, CachedFile>();

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  serve(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const file = this.#resolve(pathname);
    if (file === null) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    this.#send(req, res, file);
  }

  #resolve(pathname: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;
    const candidate = path.resolve(this.#root, `.${path.posix.normalize(decoded)}`);
    if (candidate !== this.#root && !candidate.startsWith(this.#root + path.sep)) return null;
    if (isFile(candidate)) return candidate;
    // A missing asset is a 404, not the app shell, so a stale page fails loudly.
    if (decoded.startsWith("/assets/") || path.extname(decoded) !== "") return null;
    const index = path.join(this.#root, "index.html");
    return isFile(index) ? index : null;
  }

  #send(req: IncomingMessage, res: ServerResponse, file: string): void {
    const extension = path.extname(file).toLowerCase();
    const relative = path.relative(this.#root, file).split(path.sep).join("/");
    const cached = this.#load(file);
    const encoding = COMPRESSIBLE.has(extension) ? pickEncoding(req) : null;
    const body = encoding ? this.#encode(cached, encoding) : cached.raw;

    const headers: Record<string, string | number> = {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": relative.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    };
    if (COMPRESSIBLE.has(extension)) headers.Vary = "Accept-Encoding";
    if (encoding && body !== cached.raw) headers["Content-Encoding"] = encoding;
    if (extension === ".html") Object.assign(headers, HTML_HEADERS);

    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  }

  #load(file: string): CachedFile {
    const stat = fs.statSync(file);
    const version = `${stat.mtimeMs}:${stat.size}`;
    const cached = this.#cache.get(file);
    if (cached?.version === version) return cached;
    const fresh: CachedFile = { version, raw: fs.readFileSync(file), encoded: {} };
    this.#cache.set(file, fresh);
    return fresh;
  }

  /** Compresses once per file version; small files go out as they are. */
  #encode(cached: CachedFile, encoding: Encoding): Buffer {
    if (cached.raw.length < MIN_COMPRESS_BYTES) return cached.raw;
    const existing = cached.encoded[encoding];
    if (existing) return existing;
    const encoded =
      encoding === "br"
        ? brotliCompressSync(cached.raw, {
            params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
          })
        : gzipSync(cached.raw, { level: 9 });
    cached.encoded[encoding] = encoded;
    return encoded;
  }
}

function pickEncoding(req: IncomingMessage): Encoding | null {
  const accepted = String(req.headers["accept-encoding"] ?? "");
  if (/\bbr\b/.test(accepted)) return "br";
  if (/\bgzip\b/.test(accepted)) return "gzip";
  return null;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
