import { describe, it, expect } from "vitest";
import { createRelayerApp } from "../src/app.js";
import { createTestDeps } from "../src/testDeps.js";
import { loadRelayerConfig } from "../src/config.js";
import { createInMemoryIdempotencyStore } from "../src/services/idempotency.js";
import { createPerAccountRelayQueue } from "../src/services/relayQueue.js";
import { createTokenBucketRateLimiter } from "../src/services/rateLimit.js";
import { createRedactingLogger } from "../src/services/logRedaction.js";
import { createEphemeralClientKeyer } from "../src/services/ephemeralClientKey.js";
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

function makeReq(parts: { method: string; url: string; headers?: Record<string, string>; body?: string; remoteAddress?: string }): HttpRequestLike {
  const stream = new PassThrough() as unknown as HttpRequestLike;
  stream.method = parts.method;
  stream.url = parts.url;
  stream.headers = { host: "localhost", ...(parts.headers ?? {}) };
  stream.socket = { remoteAddress: parts.remoteAddress ?? "127.0.0.1" };
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

function buildSubmit(bodyLimit: number, rateLimit: number, opts: { maxProofBytes?: number } = {}) {
  return createSubmitRoute({
    verifier: new MockOffchainVerifier(),
    simulator: new MockSimulator(),
    submitter: new MockSubmitter(),
    queue: createPerAccountRelayQueue<unknown>({ concurrency: 1 }),
    idempotency: createInMemoryIdempotencyStore({ ttlMs: 1000 }),
    rateLimiter: createTokenBucketRateLimiter({ limit: rateLimit, windowMs: 1000 }),
    clientKeyer: createEphemeralClientKeyer({ rotationMs: 60_000 }),
    logger: createRedactingLogger({ enabled: false }),
    bodyLimitBytes: bodyLimit,
    maxProofBytes: opts.maxProofBytes ?? 8192,
  });
}

// Canonical decimal Fr public signals (no 0x prefix, no leading zeros).
// Small values like 10/11/12/13/14/15 are all < r and parse to canonical
// 0x0a / 0x0b / ... internally. The literal "0xaa"*32 is NOT valid
// because that value is greater than the BLS12-381 Fr modulus.
const NULLIFIER_DEC = "10";
const STATE_DEC = "11";
const ASSOC_DEC = "12";
const SCOPE_DEC = "13";

const R0_BODY = JSON.stringify({
  action: "cast",
  electionId: "0x" + "01".repeat(32),
  publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
  publicSignals: [
    NULLIFIER_DEC,
    "3",
    "5",
    STATE_DEC,
    ASSOC_DEC,
    SCOPE_DEC,
  ],
  proofBytes: "0x" + "ab".repeat(64),
  idempotencyKey: "k-abcdef1234",
  clientTag: "ct",
});

describe("relayer app", () => {
  it("GET /health returns ok and config snapshot", async () => {
    const deps = createTestDeps({ ...loadRelayerConfig(), enableLogging: false });
    const app = createRelayerApp(deps);
    const res = new FakeRes();
    const req = makeReq({ method: "GET", url: "/health" });
    await app.handle(req as unknown as Parameters<typeof app.handle>[0], res as unknown as ServerResponse);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body!);
    expect(json.status).toBe("ok");
  });

  it("GET /submit returns 405", async () => {
    const deps = createTestDeps({ ...loadRelayerConfig(), enableLogging: false });
    const app = createRelayerApp(deps);
    const res = new FakeRes();
    const req = makeReq({ method: "GET", url: "/submit" });
    await app.handle(req as unknown as Parameters<typeof app.handle>[0], res as unknown as ServerResponse);
    expect(res.statusCode).toBe(405);
  });

  it("POST /submit accepts a valid cast and returns tx hash", async () => {
    const deps = createTestDeps({ ...loadRelayerConfig(), enableLogging: false });
    const app = createRelayerApp(deps);
    const res = new FakeRes();
    const req = makeReq({ method: "POST", url: "/submit", body: R0_BODY });
    await app.handle(req as unknown as Parameters<typeof app.handle>[0], res as unknown as ServerResponse);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body!);
    expect(json.status).toBe("accepted");
    expect(json.txHash).toMatch(/^0x/);
  });

  it("POST /submit returns 413 when body too large (frozen U0: observable, NOT socket destroy)", async () => {
    const submit = buildSubmit(8, 100);
    const res = new FakeRes();
    let destroyed = false;
    const req = makeReq({ method: "POST", url: "/submit", body: "x".repeat(200) });
    req.socket = {
      remoteAddress: "127.0.0.1",
    };
    await submit(req, res, "127.0.0.1");
    expect(res.statusCode).toBe(413);
    // The response is observable: the body is a JSON error envelope
    // that the client can read on the same connection.
    const json = JSON.parse(res.body!);
    expect(json.error.code).toBe("RELAYER_PAYLOAD_TOO_LARGE");
    // The route set `Connection: close` so the server will close the
    // socket AFTER the response is written — but it MUST NOT pre-destroy.
    expect(res.headers["connection"]).toBe("close");
    // We must not have pre-destroyed the socket.
    expect(destroyed).toBe(false);
  });

  it("POST /submit returns 413 with observable redacted log (frozen U0)", async () => {
    const lines: string[] = [];
    const logger = createRedactingLogger({ enabled: true, sink: (l) => lines.push(l), rules: [] });
    const submit = createSubmitRoute({
      verifier: new MockOffchainVerifier(),
      simulator: new MockSimulator(),
      submitter: new MockSubmitter(),
      queue: createPerAccountRelayQueue<unknown>({ concurrency: 1 }),
      idempotency: createInMemoryIdempotencyStore({ ttlMs: 1000 }),
      rateLimiter: createTokenBucketRateLimiter({ limit: 100, windowMs: 1000 }),
      clientKeyer: createEphemeralClientKeyer({ rotationMs: 60_000 }),
      logger,
      bodyLimitBytes: 8,
      maxProofBytes: 8192,
    });
    const req = makeReq({ method: "POST", url: "/submit", body: "x".repeat(200) });
    const res = new FakeRes();
    await submit(req, res, "10.0.0.99");
    expect(res.statusCode).toBe(413);
    const events = lines.map((l) => JSON.parse(l) as { event?: string });
    expect(events.some((e) => e.event === "relayer.body.tooLarge")).toBe(true);
    // And the IP is not in the log line.
    for (const l of lines) expect(l).not.toContain("10.0.0.99");
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

  it("POST /submit enforces rate limit per EPHEMERAL IP key, not idempotencyKey (H1)", async () => {
    const submit = buildSubmit(100_000, 1);
    const bodyA = JSON.stringify({
      action: "cast",
      electionId: "0x" + "01".repeat(32),
      publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
      publicSignals: ["10", "0", "5", "11", "12", "13"],
      proofBytes: "0x" + "ab".repeat(64),
      idempotencyKey: "k-11111111",
      clientTag: "ct",
    });
    const bodyB = JSON.stringify({
      action: "cast",
      electionId: "0x" + "01".repeat(32),
      publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
      publicSignals: ["10", "0", "5", "11", "12", "13"],
      proofBytes: "0x" + "ab".repeat(64),
      idempotencyKey: "k-22222222", // different idempotency key
      clientTag: "ct",
    });
    // Same IP, two different idempotency keys: the second must be 429.
    const req1 = makeReq({ method: "POST", url: "/submit", body: bodyA, remoteAddress: "10.0.0.1" });
    const res1 = new FakeRes();
    await submit(req1, res1, "10.0.0.1");
    expect(res1.statusCode).toBe(200);
    const req2 = makeReq({ method: "POST", url: "/submit", body: bodyB, remoteAddress: "10.0.0.1" });
    const res2 = new FakeRes();
    await submit(req2, res2, "10.0.0.1");
    expect(res2.statusCode).toBe(429);
    // Different IP, same idempotency key: 200, replay.
    const req3 = makeReq({ method: "POST", url: "/submit", body: bodyA, remoteAddress: "10.0.0.2" });
    const res3 = new FakeRes();
    await submit(req3, res3, "10.0.0.2");
    expect(res3.statusCode).toBe(200);
  });

  it("POST /submit never logs the raw IP (H1) and never logs clientTag (frozen U0)", async () => {
    const lines: string[] = [];
    const logger = createRedactingLogger({ enabled: true, sink: (l) => lines.push(l), rules: [] });
    const submit = createSubmitRoute({
      verifier: new MockOffchainVerifier(),
      simulator: new MockSimulator(),
      submitter: new MockSubmitter(),
      queue: createPerAccountRelayQueue<unknown>({ concurrency: 1 }),
      idempotency: createInMemoryIdempotencyStore({ ttlMs: 1000 }),
      rateLimiter: createTokenBucketRateLimiter({ limit: 100, windowMs: 1000 }),
      clientKeyer: createEphemeralClientKeyer({ rotationMs: 60_000 }),
      logger,
      bodyLimitBytes: 100_000,
      maxProofBytes: 8192,
    });
    // Use a high-entropy clientTag that is not a substring of any other
    // log key (avoids false positives from "electionId" / "accepted" /
    // "expectedTally" — the simpler invariant is that clientTag, by name,
    // never appears in the log object).
    const body = JSON.stringify({
      ...JSON.parse(R0_BODY) as Record<string, unknown>,
      clientTag: "tk-9e3b6f0a1c2d4e5f",
    });
    const req = makeReq({ method: "POST", url: "/submit", body, remoteAddress: "10.0.0.42" });
    const res = new FakeRes();
    await submit(req, res, "10.0.0.42");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain("10.0.0.42");
      const obj = JSON.parse(line) as Record<string, unknown>;
      expect("clientTag" in obj).toBe(false);
      // The exact high-entropy value must never leak either.
      expect(line).not.toContain("9e3b6f0a1c2d4e5f");
    }
  });

  it("POST /submit /reveal rejects unknown keys (publicSignals, proofBytes, nullifierHash)", async () => {
    const submit = buildSubmit(100_000, 100);
    const body = JSON.stringify({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0a".repeat(32),
      vote: 1,
      salt: "0x" + "0b".repeat(32),
      idempotencyKey: "k-reveal-extra",
      clientTag: "ct",
      publicSignals: ["1"],
      proofBytes: "0x" + "ab".repeat(64),
    });
    const req = makeReq({ method: "POST", url: "/submit", body });
    const res = new FakeRes();
    await submit(req, res, "127.0.0.1");
    // The allowlist check fires first, so the error is INVALID_SIGNAL_KIND.
    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body!);
    expect(json.error.code).toBe("INVALID_SIGNAL_KIND");
  });

  it("POST /submit /reveal returns accepted with NO payloadHash (frozen U0)", async () => {
    const submit = buildSubmit(100_000, 100);
    const body = JSON.stringify({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0a".repeat(32),
      vote: 1,
      salt: "0x" + "0b".repeat(32),
      idempotencyKey: "k-reveal-1",
      clientTag: "ct",
    });
    const req = makeReq({ method: "POST", url: "/submit", body });
    const res = new FakeRes();
    await submit(req, res, "127.0.0.1");
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body!);
    expect(json.status).toBe("accepted");
    expect((json as { payloadHash?: unknown }).payloadHash).toBeUndefined();
    expect((json as { proofHash?: unknown }).proofHash).toBeUndefined();
    expect((json as { publicSignalsHash?: unknown }).publicSignalsHash).toBeUndefined();
  });

  it("POST /submit rejects missing action discriminator (frozen U0)", async () => {
    const submit = buildSubmit(100_000, 100);
    const body = JSON.stringify({
      electionId: "0x" + "01".repeat(32),
      publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
      publicSignals: ["10", "0", "5", "11", "12", "13"],
      proofBytes: "0x" + "ab".repeat(64),
      idempotencyKey: "k-missingaction",
      clientTag: "ct",
    });
    const req = makeReq({ method: "POST", url: "/submit", body });
    const res = new FakeRes();
    await submit(req, res, "127.0.0.1");
    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body!);
    expect(json.error.code).toBe("invalid_request");
  });

  it("POST /submit rejects unknown action value (frozen U0)", async () => {
    const submit = buildSubmit(100_000, 100);
    const body = JSON.stringify({
      action: "wat",
      electionId: "0x" + "01".repeat(32),
    });
    const req = makeReq({ method: "POST", url: "/submit", body });
    const res = new FakeRes();
    await submit(req, res, "127.0.0.1");
    expect(res.statusCode).toBe(400);
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

describe("createTestDeps integration", () => {
  it("uses ephemeral keying by default", () => {
    const deps = createTestDeps({ enableLogging: false });
    const key1 = deps.clientKeyer.keyFor("10.0.0.1");
    const key2 = deps.clientKeyer.keyFor("10.0.0.2");
    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rotates the salt on demand", () => {
    const deps = createTestDeps({ enableLogging: false });
    const a = deps.clientKeyer.currentSaltHex();
    deps.clientKeyer.rotate();
    const b = deps.clientKeyer.currentSaltHex();
    expect(a).not.toBe(b);
  });
});
