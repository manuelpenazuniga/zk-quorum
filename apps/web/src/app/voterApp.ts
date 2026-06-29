import { createVoterPage, type VoterPageState } from "./voterPage.js";
import { createWorkerProverClient, type ProverClient } from "../worker/workerBoundary.js";
import { MockRelayAdapter, type RelayAdapter } from "../adapters/relayAdapter.js";
import type { CastRequest } from "@zk-quorum/protocol";
import type { AppConfig } from "../shared/config.js";

export interface VoterAppDeps {
  readonly relay: RelayAdapter;
  readonly prover: ProverClient;
  readonly config: AppConfig;
}

const MOCK_PUBLIC_SIGNALS = [
  "0x" + "11".repeat(32),
  "0",
  "5",
  "0x" + "22".repeat(32),
  "0x" + "33".repeat(32),
  "0x" + "44".repeat(32),
];

export function createVoterApp(deps: VoterAppDeps): { root: HTMLElement; dispose: () => void } {
  const page = createVoterPage();
  const setState = (s: VoterPageState) => page.setState(s);
  page.onCast(async () => {
    setState({ status: "proving", message: "Computing witness and proof inside the worker…", txHash: null, proofHash: null, publicSignalsHash: null });
    const result = await deps.prover.prove(
      {
        kind: "prove-r0",
        electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
        publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
        publicSignals: MOCK_PUBLIC_SIGNALS,
        inputs: {},
      },
      () => undefined,
    );
    if (!result.ok) {
      setState({ status: "error", message: `prover failed: ${result.reason}`, txHash: null, proofHash: null, publicSignalsHash: null });
      return;
    }
    setState({ status: "submitting", message: "Submitting to the relayer…", txHash: null, proofHash: result.proofHash, publicSignalsHash: result.publicSignalsHash });
    const request: CastRequest = {
      electionId: result.envelope.electionId,
      publicSchemaId: result.envelope.publicSchemaId,
      publicSignals: result.envelope.publicSignals,
      proofBytes: result.envelope.proofBytes,
      idempotencyKey: `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      clientTag: "voter-ui",
    };
    const relayResp = await deps.relay.submitCast(request);
    if (relayResp.status === "accepted") {
      setState({
        status: "accepted",
        message: "Ballot accepted by the relayer.",
        txHash: relayResp.txHash,
        proofHash: result.proofHash,
        publicSignalsHash: result.publicSignalsHash,
      });
    } else {
      setState({
        status: "rejected",
        message: `Ballot rejected: ${relayResp.rejectReason ?? "unknown"}`,
        txHash: null,
        proofHash: result.proofHash,
        publicSignalsHash: result.publicSignalsHash,
      });
    }
  });
  return {
    root: page.root,
    dispose: () => deps.prover.terminate(),
  };
}

export function defaultVoterDeps(config: AppConfig): VoterAppDeps {
  return {
    relay: new MockRelayAdapter(),
    prover: createWorkerProverClient(),
    config,
  };
}
