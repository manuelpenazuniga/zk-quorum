import { h } from "../shared/dom.js";

export interface VoterPageState {
  readonly status: "idle" | "proving" | "submitting" | "accepted" | "rejected" | "error";
  readonly message: string;
  readonly txHash: string | null;
  readonly proofHash: string | null;
  readonly publicSignalsHash: string | null;
}

const initial: VoterPageState = {
  status: "idle",
  message: "Voter is ready. No secret has left this page.",
  txHash: null,
  proofHash: null,
  publicSignalsHash: null,
};

export function createVoterPage() {
  let state: VoterPageState = initial;
  const root = h("main", { class: "voter-root" });
  const status = h("p", { class: "voter-status", "data-testid": "status" }, [state.message]);
  const provingProgress = h("progress", { max: "100", value: "0" });
  const txEl = h("p", { class: "voter-tx" });
  const button = h("button", { type: "button", "data-testid": "cast" }, ["Cast ballot"]);
  const warn = h("p", { class: "voter-warn" }, [
    "R0 note: vote value is public on the ledger. R1 (commit/reveal) hides the value during the election.",
  ]);
  const secretNotice = h("p", { class: "voter-secret" }, [
    "Secrets (nullifierSecret, trapdoor, salt) never leave the Web Worker boundary.",
  ]);
  root.appendChild(h("h1", {}, ["ZK-Quorum · Voter"]));
  root.appendChild(secretNotice);
  root.appendChild(warn);
  root.appendChild(status);
  root.appendChild(provingProgress);
  root.appendChild(button);
  root.appendChild(txEl);

  const update = () => {
    status.textContent = state.message;
    provingProgress.setAttribute("value", String(state.status === "proving" ? 50 : state.status === "submitting" ? 80 : state.status === "accepted" ? 100 : 0));
    txEl.textContent = state.txHash === null ? "" : `tx: ${state.txHash}`;
    button.setAttribute("disabled", state.status === "proving" || state.status === "submitting" ? "true" : "false");
  };
  update();

  return {
    root,
    setState(next: VoterPageState) {
      state = next;
      update();
    },
    onCast(listener: () => void | Promise<void>) {
      button.addEventListener("click", () => { void listener(); });
    },
  };
}
