import * as fs from "node:fs";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { FaviconFetcher } from "./favicon-fetcher.ts";

const servers: Server[] = [];
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-icons-"));
});

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function serve(handler: RequestListener): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

const ICO = Buffer.from([0, 0, 1, 0, 1, 0]);
const dataUrl = (type: string, body: Buffer) => `data:${type};base64,${body.toString("base64")}`;

describe("FaviconFetcher.served", () => {
  it("inlines /favicon.ico as a data URL", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/favicon.ico") res.writeHead(200, { "content-type": "image/x-icon" });
      else res.writeHead(404);
      res.end(req.url === "/favicon.ico" ? ICO : undefined);
    });
    expect(await new FaviconFetcher().served(port)).toBe(dataUrl("image/x-icon", ICO));
  });

  it("follows the <link rel=icon> of the home page when /favicon.ico is missing", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const port = await serve((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          '<html><head><link rel="icon" type="image/svg+xml" href="/brand.svg"></head></html>',
        );
      } else if (req.url === "/brand.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end(svg);
      } else {
        // Single-page apps answer every path with their HTML; that is not an icon.
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html></html>");
      }
    });
    expect(await new FaviconFetcher().served(port)).toBe(dataUrl("image/svg+xml", svg));
  });

  it("reads the icon link from the start of a large home page", async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    const port = await serve((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<head><link rel="icon" href="/icon.png"></head>${"x".repeat(400 * 1024)}`);
      } else if (req.url === "/icon.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(png);
      } else {
        res.writeHead(404).end();
      }
    });
    expect(await new FaviconFetcher().served(port)).toBe(dataUrl("image/png", png));
  });

  it("refuses an icon over 64 KB", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.alloc(65 * 1024));
    });
    expect(await new FaviconFetcher().served(port)).toBeNull();
  });

  it("never follows an icon link to another host", async () => {
    const port = await serve((req, res) => {
      res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/html" });
      res.end('<link rel="icon" href="https://cdn.example.com/icon.png">');
    });
    expect(await new FaviconFetcher().served(port)).toBeNull();
  });

  it("answers null when nothing listens", async () => {
    const port = await serve((_req, res) => res.end());
    servers[0]?.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await new FaviconFetcher({ timeoutMs: 200 }).served(port)).toBeNull();
  });
});

describe("FaviconFetcher.remote", () => {
  it("inlines an http image a person set in the config", async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(png);
    });
    expect(await new FaviconFetcher().remote(`http://127.0.0.1:${port}/acme.png`)).toBe(
      dataUrl("image/png", png),
    );
  });

  it("refuses what is not an image", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    });
    expect(await new FaviconFetcher().remote(`http://127.0.0.1:${port}/`)).toBeNull();
  });
});

describe("FaviconFetcher.inFolder", () => {
  function write(relative: string, content: Buffer | string): void {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  it("reads public/favicon.svg first", () => {
    write("public/favicon.svg", "<svg/>");
    write("app/icon.png", Buffer.from([1]));
    expect(new FaviconFetcher().inFolder(dir)).toBe(
      dataUrl("image/svg+xml", Buffer.from("<svg/>")),
    );
  });

  it("reads app/icon.* and static/favicon.*", () => {
    write("static/favicon.png", Buffer.from([2]));
    expect(new FaviconFetcher().inFolder(dir)).toBe(dataUrl("image/png", Buffer.from([2])));
    write("app/icon.ico", ICO);
    expect(new FaviconFetcher().inFolder(dir)).toBe(dataUrl("image/x-icon", ICO));
  });

  it("skips files over 64 KB and folders without an icon", () => {
    write("public/favicon.ico", Buffer.alloc(65 * 1024));
    expect(new FaviconFetcher().inFolder(dir)).toBeNull();
    expect(new FaviconFetcher().inFolder(path.join(dir, "missing"))).toBeNull();
  });
});
