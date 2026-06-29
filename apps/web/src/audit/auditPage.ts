import { h } from "../shared/dom.js";

export interface AuditPageState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly message: string;
  readonly summary: Readonly<Record<string, unknown>> | null;
}

const initial: AuditPageState = { status: "idle", message: "Drop or paste a bundle to audit.", summary: null };

export function createAuditPage() {
  let state: AuditPageState = initial;
  const root = h("main", { class: "audit-root" });
  const file = h("input", { type: "file", accept: "application/json", "data-testid": "bundle-input" });
  const load = h("button", { type: "button", "data-testid": "load-bundle" }, ["Load bundle"]);
  const status = h("p", { class: "audit-status", "data-testid": "status" }, [state.message]);
  const summary = h("pre", { class: "audit-summary" });
  root.appendChild(h("h1", {}, ["ZK-Quorum · Audit"]));
  root.appendChild(h("p", {}, ["Audit is fully local. No data leaves the page."]));
  root.appendChild(file);
  root.appendChild(load);
  root.appendChild(status);
  root.appendChild(summary);

  const update = () => {
    status.textContent = state.message;
    summary.textContent = state.summary === null ? "" : JSON.stringify(state.summary, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  };
  update();

  return {
    root,
    onLoad(listener: (file: File) => void | Promise<void>) {
      load.addEventListener("click", () => {
        const f = (file as unknown as { files: FileList | null }).files?.[0];
        if (f) void listener(f);
      });
    },
    setState(next: AuditPageState) {
      state = next;
      update();
    },
  };
}
