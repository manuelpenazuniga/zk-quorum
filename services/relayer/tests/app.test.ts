import { describe, it, expect } from "vitest";
import { createRelayerApp, createDefaultDeps } from "../src/app.js";
import { loadRelayerConfig } from "../src/config.js";
import { createInMemoryIdempotencyStore } from "../src/services/idempotency.js";
import { createPerAccountRelayQueue } from "../src/services/relayQueue.js";
import { createTokenBucketRateLimiter } from "../src/services/rateLimit.js";
import { createRedactingLogger } from "../src/services/logRedaction.js";
import { MockOffchainVerifier, MockSimulator, MockSubmitter } from "../src/adapters/mockAdapters.js";
import { createSubmitRoute } from "../src/routes/submit.js";
import { writeJson, writeError, type HttpRequestLike, type HttpResponseLike } from "../src/middleware/http.js";
import { PassThrough } from "node:stream";
import type { ServerResponse } from "node:http";

class FakeRes implements HttpResponseLike {
  public statusCode = 0;
  public headers: Record<string, string> = {};
  public body: string | null = null;
  public setHeader(k: string, v: string | number): void { this.headers[k.toLowerCase()] = String(v); }
  public getHeader(k: string): unknown { return this.headers[k.toLowerCase()]; }
  public end(p?: string | Buffer): void { if (p !== undefined) this.body = p.toString(); }
}

function makeReq(parts: { method: string; url: string; headers?: Record<string, string>; body?: string }): HttpRequestLike {
  const stream = new PassThrough() as unknown as HttpRequestLike;
  stream.method = parts.method;
  stream.url = parts.url;
  stream.headers = { host: "localhost", ...(parts.headers ?? {}) };
  stream.socket = { remoteAddress: "127.0.0.1" };
  if (parts.body !== undefined) {
    queueMicrotask(() => {
      (stream as unknown as { push: (s: string | null) => void }).push(parts.body!);
      (stream as unknown as { push: (s: string | null) => void }).push(null);
    });
  } else {
    queueMicrotask(() => (stream as unknown as { push: (s: string | null) => void }).push(null));
  }
  return stream;
}

function buildSubmit(bodyLimit: number, rateLimit: number) {
  return createSubmitRoute({
    verifier: new MockOffchainVerifier(),
    simulator: new MockSimulator(),
    submitter: new MockSubmitter(),
    queue: createPerAccountRelayQueue<unknown>({ concurrency: 1 }),
    idempotency: createInMemoryIdempotencyStore({ ttlMs: 1000 }),
    rateLimiter: createTokenBucketRateLimiter({ limit: rateLimit, windowMs: 1000 }),
    logger: createRedactingLogger({ enabled: false }),
    bodyLimitBytes: bodyLimit,
  });
}

const R0_BODY = JSON.stringify({
  electionId: "0x" + "01".repeat(32),
  publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
  publicSignals: [
    "0x" + "aa".repeat(32),
    "3",
    "5",
    "0x" + "02".repeat(32),
    "0x" + "03".repeat(32),
    "0x" + "04".repeat(32),
  ],
  proofBytes: "0x" + "ab".repeat(64),
  idempotencyKey: "k-abcdef1234",
  clientTag: "ct",
});

describe("relayer app", () => {
  it("GET /health returns ok and config snapshot", async () => {
    const deps = createDefaultDeps({ ...loadRelayerConfig(), enableLogging: false });
    const app = createRelayerApp(deps);
    const res = new FakeRes();
    const req = makeReq({ method: "GET", url: "/health" });
    await app.handle(req as unknown as Parameters<typeof app.handle>[0], res as unknown as ServerResponse);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body!);
    expect(json.status).toBe("ok");
  });

  it("GET /submit returns 405", async () => {
    const deps = createDefaultDeps({ ...loadRelayerConfig(), enableLogging: false });
    const app = createRelayerApp(deps);
    const res = new FakeRes();
    const req = makeReq({ method: "GET", url: "/submit" });
    await app.handle(req as unknown as Parameters<typeof app.handle>[0], res as unknown as ServerResponse);
    expect(res.statusCode).toBe(405);
  });

  it("POST /submit accepts a valid cast and returns tx hash", async () => {
    const deps = createDefaultDeps({ ...loadRelayerConfig(), enableLogging: false });
    const app = createRelayerApp(deps);
    const res = new FakeRes();
    const req = makeReq({ method: "POST", url: "/submit", body: R0_BODY });
    await app.handle(req as unknown as Parameters<typeof app.handle>[0], res as unknown as ServerResponse);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body!);
    expect(json.status).toBe("accepted");
    expect(json.txHash).toMatch(/^0x/);
  });

  it("POST /submit returns 413 when body too large", async () => {
    const submit = buildSubmit(8, 100);
    const res = new FakeRes();
    const req = makeReq({ method: "POST", url: "/submit", body: "x".repeat(200) });
    await submit(req, res, "127.0.0.1");
    expect(res.statusCode).toBe(413);
  });

  it("POST /submit returns 400 on invalid JSON", async () => {
    const submit = buildSubmit(1000, 100);
    const res = new FakeRes();
    const req = makeReq({ method: "POST", url: "/submit", body: "{not json" });
    await submit(req, res, "127.0.0.1");
    expect(res.statusCode).toBe(400);
  });

  it("POST /submit returns 200 with replay flag on idempotency replay", async () => {
    const submit = buildSubmit(100_000, 100);
    const req1 = makeReq({ method: "POST", url: "/submit", body: R0_BODY });
    const res1 = new FakeRes();
    await submit(req1, res1, "127.0.0.1");
    expect(res1.statusCode).toBe(200);
    const req2 = makeReq({ method: "POST", url: "/submit", body: R0_BODY });
    const res2 = new FakeRes();
    await submit(req2, res2, "127.0.0.1");
    expect(res2.statusCode).toBe(200);
    const json2 = JSON.parse(res2.body!);
    expect(json2.replay).toBe(true);
  });

  it("POST /submit returns 429 on rate limit", async () => {
    const submit = buildSubmit(100_000, 1);
    const req1 = makeReq({ method: "POST", url: "/submit", body: R0_BODY });
    const res1 = new FakeRes();
    await submit(req1, res1, "127.0.0.1");
    const req2 = makeReq({ method: "POST", url: "/submit", body: R0_BODY });
    const res2 = new FakeRes();
    await submit(req2, res2, "127.0.0.1");
    expect(res2.statusCode).toBe(429);
  });
});

describe("middleware helpers", () => {
  it("writeJson and writeError set status/body", () => {
    const r = new FakeRes();
    writeJson(r, 201, { ok: true });
    expect(r.statusCode).toBe(201);
    const r2 = new FakeRes();
    writeError(r2, 503, "x", "y");
    expect(r2.statusCode).toBe(503);
  });
});
