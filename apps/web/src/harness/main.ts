/**
 * U-Pre harness — gate page for browser prover validation.
 *
 * Provides: Run valid R0, Run invalid witness, Cancel
 * Shows: stage, duration, verify result, sizes/hashes, memory
 * Exposes: window.__ZKQ_HARNESS_RESULT__ for automation
 *
 * NEVER renders or exposes secret inputs in DOM, console, URL, storage,
 * or worker response. Fixture embedded at build time.
 */

import { createWorkerProverClient, type ProverClient } from "../worker/workerBoundary.js";
import type { ProvingRequest, ProvingResponse } from "../adapters/provingAdapter.js";
import { PROOF_BYTE_LEN, PUBLIC_SIGNALS_BYTE_LEN } from "../adapters/sorobanEncoding.js";

// ── Embedded fixture (depth 10, r0-vote-0.json) ──

const FIXTURE_INPUTS = {
  vote: "0",
  optionCount: "5",
  stateRoot: "20660557021851646197600388443100395731422898485530646641308945670627648046745",
  associationRoot: "15158607067770416787260666106207400886047671983031147357404418838572728018630",
  electionScope: "1234567890123456789012345678901234567890123456789012345678901234",
  label: "111",
  nullifierSecret: "222",
  trapdoor: "333",
  stateIndex: "0",
  stateSiblings: [
    "0", "51576823595707970152643159819788304363803754756066229172775779360774743019614",
    "33646187916922823865935622258451714952164674255482660942215703235411158105736",
    "27818645450144846908742692719385898720249207574255739267233226464286012246073",
    "39404029000907277292464556408734412130261913210564395069696342233560511006152",
    "24907123534309659921713005795092724527532698077589223246276579583330771465031",
    "22103361713848256938655449390262013863291224679776344310249539314760174194771",
    "28665358770471415124367990738618755861132249577405347373337125991381323369983",
    "6786998243528185650306462855937293964443624194496859265310261299800128548513",
    "50997336463747555660384185705133244552288600683323691317203235239320942865561",
  ],
  associationIndex: "0",
  associationSiblings: [
    "0", "51576823595707970152643159819788304363803754756066229172775779360774743019614",
    "33646187916922823865935622258451714952164674255482660942215703235411158105736",
    "27818645450144846908742692719385898720249207574255739267233226464286012246073",
    "39404029000907277292464556408734412130261913210564395069696342233560511006152",
    "24907123534309659921713005795092724527532698077589223246276579583330771465031",
    "22103361713848256938655449390262013863291224679776344310249539314760174194771",
    "28665358770471415124367990738618755861132249577405347373337125991381323369983",
    "6786998243528185650306462855937293964443624194496859265310261299800128548513",
    "50997336463747555660384185705133244552288600683323691317203235239320942865561",
  ],
};

const FIXTURE_NULLIFIER_HASH = "15309246400844181668452549791295656752795519099905502581510248520065524481077";
const FIXTURE_PUBLIC_SIGNALS = [
  FIXTURE_NULLIFIER_HASH,
  FIXTURE_INPUTS.vote,
  FIXTURE_INPUTS.optionCount,
  FIXTURE_INPUTS.stateRoot,
  FIXTURE_INPUTS.associationRoot,
  FIXTURE_INPUTS.electionScope,
];

const FIXTURE_ELECTION_ID = ("0x" + "ab".repeat(32)) as `0x${string}`;

const INVALID_INPUTS: Record<string, unknown> = {
  ...FIXTURE_INPUTS,
  stateRoot: "9999999999999999999999999999999999999999999999999999999999999999",
};

// ── DOM ──

const btnValid = document.getElementById("btn-valid") as HTMLButtonElement;
const btnInvalid = document.getElementById("btn-invalid") as HTMLButtonElement;
const btnCancel = document.getElementById("btn-cancel") as HTMLButtonElement;
const outputEl = document.getElementById("output")!;
const summaryEl = document.getElementById("summary")!;

// ── State ──

let prover: ProverClient | null = null;
let currentTest: string | null = null;
let testResults: TestResult[] = [];

interface MemoryInfo {
  readonly peakMemory: "unsupported";
  readonly heapLimitMB: number | null;
}

interface TestResult {
  test: string;
  stage: "pass" | "fail";
  durationMs: number;
  message: string;
  proofHash: string | null;
  publicSignalsHash: string | null;
  signalCount: number | null;
  proofByteLen: number | null;
  publicByteLen: number | null;
  peakMemory: "unsupported";
  heapLimitMB: number | null;
}

function memoryInfo(): MemoryInfo {
  let heapLimitMB: number | null = null;
  if (typeof performance !== "undefined" && "memory" in performance) {
    const m = (performance as unknown as { memory?: { jsHeapSizeLimit?: number } }).memory;
    if (m?.jsHeapSizeLimit) {
      heapLimitMB = Math.round(m.jsHeapSizeLimit / 1024 / 1024);
    }
  }
  return { peakMemory: "unsupported", heapLimitMB };
}

function memDisplay(m: MemoryInfo): string {
  return `peak=unsupported limit=${m.heapLimitMB ?? "unsupported"}MB`;
}

// ── UI ──

function setButtons(enabled: boolean) {
  btnValid.disabled = !enabled;
  btnInvalid.disabled = !enabled;
  btnCancel.disabled = enabled;
}

function appendResult(result: TestResult) {
  const cls = result.stage === "pass" ? "pass" : "fail";
  const div = document.createElement("div");
  div.className = `result ${cls}`;
  div.innerHTML = `<strong>${result.test}</strong> [${result.stage.toUpperCase()}] <span class="mem">${memDisplay({ peakMemory: result.peakMemory, heapLimitMB: result.heapLimitMB })}</span><br><small>${result.message}</small>`;
  outputEl.appendChild(div);
}

function appendSummary() {
  const passCount = testResults.filter((r) => r.stage === "pass").length;
  const failCount = testResults.filter((r) => r.stage === "fail").length;
  summaryEl.innerHTML = `<p><strong>Summary:</strong> ${passCount} pass, ${failCount} fail, ${testResults.length} total</p>`;
}

function exposeResult() {
  (window as unknown as Record<string, unknown>).__ZKQ_HARNESS_RESULT__ = {
    gate: "U-PRE-BROWSER-R0",
    tests: testResults,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    peakMemory: "unsupported" as const,
    heapLimitMB: memoryInfo().heapLimitMB,
  };
}

// ── Run ──

function makeReq(inputs: Record<string, unknown>): ProvingRequest {
  return {
    kind: "prove-r0",
    electionId: FIXTURE_ELECTION_ID,
    publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
    publicSignals: [...FIXTURE_PUBLIC_SIGNALS],
    inputs,
  };
}

function pushResult(r: TestResult) {
  testResults.push(r);
}

function runTest(name: string, inputs: Record<string, unknown>, expectOk: boolean): void {
  if (prover !== null) prover.terminate();
  currentTest = name;
  prover = createWorkerProverClient();

  const start = performance.now();
  const mem = memoryInfo();

  prover.prove(makeReq(inputs), (_p) => {
    // progress not displayed in harness UI
  }).then((resp: ProvingResponse) => {
    const elapsed = Math.round(performance.now() - start);

    // Handle cancel: the boundary resolves (not rejects) with reason "cancelled"
    if (!resp.ok && resp.reason === "cancelled") {
      pushResult({
        test: "cancel-r0",
        stage: "pass",
        durationMs: elapsed,
        message: `Cancelled in ${elapsed}ms`,
        proofHash: null, publicSignalsHash: null, signalCount: null,
        proofByteLen: null, publicByteLen: null,
        peakMemory: "unsupported", heapLimitMB: mem.heapLimitMB,
      });
      finish();
      return;
    }

    if (resp.ok === expectOk) {
      if (resp.ok) {
        const signals = resp.envelope.publicSignals;
        const proofByteLen = (resp.envelope.proofBytes.length - 2) / 2;
        pushResult({
          test: name,
          stage: "pass",
          durationMs: elapsed,
          message: `Proof generated in ${elapsed}ms. Signals: ${signals.length}. Proof: ${proofByteLen} bytes.`,
          proofHash: resp.proofHash,
          publicSignalsHash: resp.publicSignalsHash,
          signalCount: signals.length,
          proofByteLen,
          publicByteLen: PUBLIC_SIGNALS_BYTE_LEN,
          peakMemory: "unsupported", heapLimitMB: mem.heapLimitMB,
        });
      } else {
        pushResult({
          test: name,
          stage: "pass",
          durationMs: elapsed,
          message: `Correctly rejected: ${resp.reason}`,
          proofHash: null, publicSignalsHash: null, signalCount: null,
          proofByteLen: null, publicByteLen: null,
          peakMemory: "unsupported", heapLimitMB: mem.heapLimitMB,
        });
      }
    } else {
      pushResult({
        test: name,
        stage: "fail",
        durationMs: elapsed,
        message: resp.ok ? `Expected failure but got success` : `Unexpected: ${resp.reason}`,
        proofHash: resp.ok ? resp.proofHash : null,
        publicSignalsHash: resp.ok ? resp.publicSignalsHash : null,
        signalCount: resp.ok ? resp.envelope.publicSignals.length : null,
        proofByteLen: resp.ok ? PROOF_BYTE_LEN : null,
        publicByteLen: resp.ok ? PUBLIC_SIGNALS_BYTE_LEN : null,
        peakMemory: "unsupported", heapLimitMB: mem.heapLimitMB,
      });
    }
    finish();
  }).catch((e: unknown) => {
    const elapsed = Math.round(performance.now() - start);
    const msg = e instanceof Error ? e.message : String(e);
    pushResult({
      test: name,
      stage: "fail",
      durationMs: elapsed,
      message: `Error: ${msg}`,
      proofHash: null, publicSignalsHash: null, signalCount: null,
      proofByteLen: null, publicByteLen: null,
      peakMemory: "unsupported", heapLimitMB: mem.heapLimitMB,
    });
    finish();
  });
}

function finish() {
  setButtons(true);
  currentTest = null;
  appendResult(testResults[testResults.length - 1]!);
  appendSummary();
  exposeResult();
}

// ── Event handlers ──

function nextValidName(): string {
  // If cancel-r0 exists without recovery-r0, name it recovery-r0
  const hasCancel = testResults.some((r) => r.test === "cancel-r0");
  const hasRecovery = testResults.some((r) => r.test === "recovery-r0");
  if (hasCancel && !hasRecovery) return "recovery-r0";
  return "valid-r0";
}

btnValid.addEventListener("click", () => {
  setButtons(false);
  runTest(nextValidName(), FIXTURE_INPUTS, true);
});

btnInvalid.addEventListener("click", () => {
  setButtons(false);
  runTest("invalid-witness", INVALID_INPUTS, false);
});

btnCancel.addEventListener("click", () => {
  if (prover !== null && currentTest !== null) {
    prover.cancel();
  }
});

// ── Startup ──

setButtons(true);
outputEl.innerHTML = "<p>Ready. Click a button to run a test.</p>";
