/**
 * U-Pre harness — gate page for browser prover validation.
 *
 * Provides: Run valid R0, Run invalid witness, Cancel
 * Shows: stage, duration, verify result, sizes/hashes, memory
 * Exposes: window.__ZKQ_HARNESS_RESULT__ for automation
 *
 * NEVER renders or exposes secret inputs (nullifierSecret, trapdoor,
 * siblings, label, witness) in DOM, console, URL, storage, or worker
 * response. The fixture is embedded at build time and never shown.
 */

import { createWorkerProverClient, type ProverClient } from "../worker/workerBoundary.js";
import type { ProvingRequest, ProvingResponse } from "../adapters/provingAdapter.js";
import { PROOF_BYTE_LEN, PUBLIC_SIGNALS_BYTE_LEN } from "../adapters/sorobanEncoding.js";

// ── Embedded fixture (depth 10, from circuits/artifacts/fixtures/r0-vote-0.json) ──
// Embedded at build time — never fetched from network, never shown in UI.

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
    "0",
    "51576823595707970152643159819788304363803754756066229172775779360774743019614",
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
    "0",
    "51576823595707970152643159819788304363803754756066229172775779360774743019614",
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

// Public signals are ordered as circuit output:
// [0] nullifierHash (output, unknown), [1] vote, [2] optionCount,
// [3] stateRoot, [4] associationRoot, [5] electionScope
// Index 0 is empty string — the adapter skips index 0 in comparison.
const FIXTURE_PUBLIC_SIGNALS = [
  "",  // nullifierHash — output only, cannot precompute
  FIXTURE_INPUTS.vote,
  FIXTURE_INPUTS.optionCount,
  FIXTURE_INPUTS.stateRoot,
  FIXTURE_INPUTS.associationRoot,
  FIXTURE_INPUTS.electionScope,
];

const FIXTURE_ELECTION_ID = ("0x" + "ab".repeat(32)) as `0x${string}`;

// ── Invalid witness fixture (wrong root) ──

const INVALID_INPUTS = {
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

interface TestResult {
  test: string;
  stage: "pass" | "fail" | "pending";
  durationMs: number;
  message: string;
  proofHash: string | null;
  publicSignalsHash: string | null;
  signalCount: number | null;
  proofByteLen: number | null;
  publicByteLen: number | null;
  memoryAvailable: string;
}

function memoryInfo(): string {
  if (typeof performance !== "undefined" && "memory" in performance) {
    const m = (performance as unknown as { memory?: { jsHeapSizeLimit?: number } }).memory;
    if (m?.jsHeapSizeLimit) {
      return `${Math.round(m.jsHeapSizeLimit / 1024 / 1024)} MB limit`;
    }
  }
  return "unsupported";
}

// ── UI helpers ──

function setButtons(enabled: boolean) {
  btnValid.disabled = !enabled;
  btnInvalid.disabled = !enabled;
  btnCancel.disabled = enabled;
}

function appendResult(result: TestResult) {
  const cls = result.stage === "pass" ? "pass" : result.stage === "fail" ? "fail" : "pending";
  const div = document.createElement("div");
  div.className = `result ${cls}`;
  div.innerHTML = `<strong>${result.test}</strong> [${result.stage.toUpperCase()}] <span class="mem">${result.memoryAvailable}</span><br>
    <small>${result.message}</small>`;
  outputEl.appendChild(div);
}

function appendSummary() {
  const passCount = testResults.filter((r) => r.stage === "pass").length;
  const failCount = testResults.filter((r) => r.stage === "fail").length;
  summaryEl.innerHTML = `<p><strong>Summary:</strong> ${passCount} pass, ${failCount} fail, ${testResults.length} total</p>`;
}

// Expose for automation
function exposeResult() {
  (window as unknown as Record<string, unknown>).__ZKQ_HARNESS_RESULT__ = {
    gate: "U-PRE-BROWSER-R0",
    tests: testResults,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    memoryAvailable: memoryInfo(),
  };
}

// ── Run helpers ──

function runTest(name: string, inputs: Record<string, unknown>, expectedOk: boolean): void {
  if (prover !== null) {
    prover.terminate();
  }
  currentTest = name;
  prover = createWorkerProverClient();

  const start = performance.now();
  const memStart = memoryInfo();

  const req: ProvingRequest = {
    kind: "prove-r0",
    electionId: FIXTURE_ELECTION_ID,
    publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
    publicSignals: FIXTURE_PUBLIC_SIGNALS.filter((s) => s !== ""),
    inputs,
  };

  prover.prove(req, (_p) => {
    // progress callback — tracking not displayed in harness UI
  }).then((resp: ProvingResponse) => {
    const elapsed = Math.round(performance.now() - start);
    if (currentTest !== name) return; // stale

    if (resp.ok && expectedOk) {
      // Success path: valid proof
      const signals = resp.envelope.publicSignals;
      const proofHex = resp.envelope.proofBytes;
      const proofByteLen = (proofHex.length - 2) / 2; // hex → bytes
      testResults.push({
        test: name,
        stage: "pass",
        durationMs: elapsed,
        message: `Proof generated in ${elapsed}ms. Signals: ${signals.length}. Proof: ${proofByteLen} bytes. Hash: ${resp.proofHash.slice(0, 18)}...`,
        proofHash: resp.proofHash,
        publicSignalsHash: resp.publicSignalsHash,
        signalCount: signals.length,
        proofByteLen,
        publicByteLen: PUBLIC_SIGNALS_BYTE_LEN,
        memoryAvailable: memStart,
      });
    } else if (!resp.ok && !expectedOk) {
      // Expected failure
      testResults.push({
        test: name,
        stage: "pass",
        durationMs: elapsed,
        message: `Correctly rejected: ${resp.reason}`,
        proofHash: null,
        publicSignalsHash: null,
        signalCount: null,
        proofByteLen: null,
        publicByteLen: null,
        memoryAvailable: memStart,
      });
    } else {
      testResults.push({
        test: name,
        stage: "fail",
        durationMs: elapsed,
        message: resp.ok
          ? `Expected failure but got success (${elapsed}ms)`
          : `Unexpected failure: ${resp.reason}`,
        proofHash: resp.ok ? resp.proofHash : null,
        publicSignalsHash: resp.ok ? resp.publicSignalsHash : null,
        signalCount: resp.ok ? resp.envelope.publicSignals.length : null,
        proofByteLen: resp.ok ? PROOF_BYTE_LEN : null,
        publicByteLen: resp.ok ? PUBLIC_SIGNALS_BYTE_LEN : null,
        memoryAvailable: memStart,
      });
    }
    finish();
  }).catch((e: unknown) => {
    const elapsed = Math.round(performance.now() - start);
    if (currentTest !== name) return;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "cancelled" && expectedOk === false) {
      // Cancel is expected for some tests
      testResults.push({
        test: name,
        stage: "pass",
        durationMs: elapsed,
        message: `Cancelled in ${elapsed}ms`,
        proofHash: null,
        publicSignalsHash: null,
        signalCount: null,
        proofByteLen: null,
        publicByteLen: null,
        memoryAvailable: memStart,
      });
    } else {
      testResults.push({
        test: name,
        stage: "fail",
        durationMs: elapsed,
        message: `Error: ${msg}`,
        proofHash: null,
        publicSignalsHash: null,
        signalCount: null,
        proofByteLen: null,
        publicByteLen: null,
        memoryAvailable: memStart,
      });
    }
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

btnValid.addEventListener("click", () => {
  setButtons(false);
  runTest("valid-r0", FIXTURE_INPUTS, true);
});

btnInvalid.addEventListener("click", () => {
  setButtons(false);
  runTest("invalid-witness", INVALID_INPUTS, false);
});

btnCancel.addEventListener("click", () => {
  if (prover !== null && currentTest !== null) {
    prover.cancel();
    // The cancel resolves the pending promise, so the test's handler manages state
    currentTest = null;
    setButtons(true);
  }
});

// ── Startup ──

setButtons(true);
outputEl.innerHTML = "<p>Ready. Click a button to run a test.</p>";
