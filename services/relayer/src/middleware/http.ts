import type { IncomingMessage, ServerResponse } from "node:http";

export interface HttpRequestLike {
  method: string;
  url: string;
  headers: NodeJS.Dict<string | string[]>;
  socket?: { remoteAddress?: string };
  on(event: "data", cb: (chunk: Buffer) => void): void;
  on(event: "end", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
}

export interface HttpResponseLike {
  setHeader(name: string, value: string | number): void;
  getHeader(name: string): unknown;
  statusCode: number;
  end(payload?: string | Buffer): void;
}

export interface RouteContext {
  readonly req: HttpRequestLike;
  readonly res: HttpResponseLike;
  readonly body: Buffer;
  readonly url: URL;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

export interface ParsedHttpBody {
  readonly ok: boolean;
  readonly body: Buffer;
  readonly reason?: string;
}

export function readBody(req: HttpRequestLike, limit: number): Promise<ParsedHttpBody> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > limit) {
        aborted = true;
        resolve({ ok: false, body: Buffer.alloc(0), reason: "body exceeded limit" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve({ ok: true, body: Buffer.concat(chunks) });
    });
    req.on("error", (err) => {
      if (aborted) return;
      aborted = true;
      resolve({ ok: false, body: Buffer.alloc(0), reason: err.message });
    });
  });
}

export function writeJson(res: HttpResponseLike, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export function writeError(res: HttpResponseLike, status: number, code: string, message: string, extra?: Record<string, unknown>): void {
  writeJson(res, status, { error: { code, message, ...(extra ?? {}) } });
}

export function isMethod(req: IncomingMessage | HttpRequestLike, method: string): boolean {
  if (req.method === undefined) return false;
  return req.method.toUpperCase() === method.toUpperCase();
}

export type RawReq = IncomingMessage;
export type RawRes = ServerResponse;
