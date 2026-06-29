# `@zk-quorum/auditor`

Independent audit CLI. Discovers events, dedups nullifiers, reconstructs
tallies, audits R1 commit/reveal/non-reveal. Operates on a local
`AUDIT_BUNDLE_V1` JSON bundle — no network, no chain calls.

## CLI

```bash
zkq-auditor verify  --bundle <path> [--r0-options 5] [--r1-options 5] [--json]
zkq-auditor replay  --bundle <path> [--r0-options 5] [--r1-options 5] \
                          [--expected-tally 10,20,30,5,1]
zkq-auditor tally   --bundle <path>
zkq-auditor r1      --bundle <path>
```

Exit code: `0` ok, `1` findings, `2` usage error.

## Bundle shape

`AUDIT_BUNDLE_V1` (see `src/domain/bundle.ts`):

```jsonc
{
  "schema": "AUDIT_BUNDLE_V1",
  "electionId": "0x…",
  "manifestHash": "0x…",
  "contractId": "C…",
  "wasmHash": "0x…",
  "vkR0Hash": "0x…",
  "vkR1Hash": "0x…",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "events": [ /* VoteCastV1, VoteCommittedV1, VoteRevealedV1 */ ],
  "proofArchive": [
    { "txHash": "…", "proofHash": "0x…", "publicSignalsHash": "0x…", "payloadHex": "0x…" }
  ],
  "tallies": { "R0": {}, "R1": {} }
}
```

## Integration TODOs

See `AUDITOR_INTEGRATION.md` for the exact seams that need filling before
the auditor can verify real Groth16 proofs.
