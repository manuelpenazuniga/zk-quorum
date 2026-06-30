import type { CastRequest, CastResponse, NullifierHash, RevealRequest, RevealResponse } from "@zk-quorum/protocol";
import { decimalFrToHex32 } from "@zk-quorum/protocol";

export interface RelayAdapter {
  submitCast(req: CastRequest): Promise<CastResponse>;
  submitReveal(req: RevealRequest): Promise<RevealResponse>;
  readonly endpoint: string;
}

/**
 * Adapter from the voter's perspective. Accepts a `CastRequest` /
 * `RevealRequest` (canonical decimal Fr wire format on the wire) and
 * returns the relay's response. We never invent hashes locally: a
 * rejected cast returns `proofHash: null, publicSignalsHash: null`,
 * and a reveal response has no `payloadHash` field at all.
 */
export class HttpRelayAdapter implements RelayAdapter {
  constructor(public readonly endpoint: string, private readonly fetchImpl: typeof fetch = fetch) {}

  public async submitCast(req: CastRequest): Promise<CastResponse> {
    const r = await this.fetchImpl(`${this.endpoint}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      return {
        status: "rejected",
        txHash: null,
        // nullifierHash is REQUIRED on CastResponse: derive it from the
        // public signals (canonical decimal, slot 0 is nullifierHash).
        nullifierHash: decimalFrToHex32(req.publicSignals[0] ?? "0", "nullifierHash"),
        proofHash: null,
        publicSignalsHash: null,
        rejectReason: err.error?.message ?? `relayer ${r.status}`,
      };
    }
    return (await r.json()) as CastResponse;
  }

  public async submitReveal(req: RevealRequest): Promise<RevealResponse> {
    const r = await this.fetchImpl(`${this.endpoint}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...req, action: "reveal" }),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      return {
        status: "rejected",
        txHash: null,
        ballotCommitment: req.ballotCommitment,
        rejectReason: err.error?.message ?? `relayer ${r.status}`,
      };
    }
    return (await r.json()) as RevealResponse;
  }
}

/**
 * Dev/test adapter. Returns accepted responses that mirror the real
 * relayer wire shape: a derived nullifierHash from the request, non-zero
 * synthetic SHA-256-like hexes, and reveal responses WITHOUT
 * payloadHash/proofHash/publicSignalsHash. The "synthetic hashes" are
 * obviously fake; tests MUST assert on the relay wire shape, not on
 * these values being real.
 */
export class MockRelayAdapter implements RelayAdapter {
  public readonly endpoint = "mock://relayer";
  public async submitCast(req: CastRequest): Promise<CastResponse> {
    const nh: NullifierHash = decimalFrToHex32(req.publicSignals[0] ?? "0", "nullifierHash");
    return {
      status: "accepted",
      txHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
      nullifierHash: nh,
      proofHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
      publicSignalsHash: ("0x" + "ce".repeat(32)) as `0x${string}`,
      rejectReason: null,
    };
  }
  public async submitReveal(req: RevealRequest): Promise<RevealResponse> {
    return {
      status: "accepted",
      txHash: ("0x" + "ef".repeat(32)) as `0x${string}`,
      ballotCommitment: req.ballotCommitment,
      rejectReason: null,
    };
  }
}
