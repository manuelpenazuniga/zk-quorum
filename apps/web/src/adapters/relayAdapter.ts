import type { CastRequest, CastResponse, RevealRequest, RevealResponse } from "@zk-quorum/protocol";

export interface RelayAdapter {
  submitCast(req: CastRequest): Promise<CastResponse>;
  submitReveal(req: RevealRequest): Promise<RevealResponse>;
  readonly endpoint: string;
}

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
        nullifierHash: req.publicSignals[0] as `0x${string}`,
        proofHash: "0x" + "00".repeat(32) as never,
        publicSignalsHash: "0x" + "00".repeat(32) as never,
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
        proofHash: "0x" + "00".repeat(32) as never,
        publicSignalsHash: "0x" + "00".repeat(32) as never,
        rejectReason: err.error?.message ?? `relayer ${r.status}`,
      };
    }
    return (await r.json()) as RevealResponse;
  }
}

export class MockRelayAdapter implements RelayAdapter {
  public readonly endpoint = "mock://relayer";
  public async submitCast(req: CastRequest): Promise<CastResponse> {
    return {
      status: "accepted",
      txHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
      nullifierHash: req.publicSignals[0] as `0x${string}`,
      proofHash: "0x" + "00".repeat(32) as never,
      publicSignalsHash: "0x" + "00".repeat(32) as never,
      rejectReason: null,
    };
  }
  public async submitReveal(req: RevealRequest): Promise<RevealResponse> {
    return {
      status: "accepted",
      txHash: ("0x" + "ef".repeat(32)) as `0x${string}`,
      ballotCommitment: req.ballotCommitment,
      proofHash: "0x" + "00".repeat(32) as never,
      publicSignalsHash: "0x" + "00".repeat(32) as never,
      rejectReason: null,
    };
  }
}
