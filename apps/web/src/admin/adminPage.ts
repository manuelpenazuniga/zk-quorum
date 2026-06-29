import { h } from "../shared/dom.js";

export interface AdminPageState {
  readonly status: "idle" | "submitting" | "submitted" | "error";
  readonly electionId: string;
  readonly schemaId: string;
  readonly optionCount: number;
  readonly message: string;
}

const initial: AdminPageState = {
  status: "idle",
  electionId: "",
  schemaId: "PUBLIC_SCHEMA_V1_R0",
  optionCount: 5,
  message: "Admin tool is offline until the contract id and manifest are published.",
};

export interface AdminPageHandle {
  root: HTMLElement;
  getState(): AdminPageState;
  setState(next: AdminPageState): void;
  onOpen(listener: (s: AdminPageState) => void | Promise<void>): void;
}

export function createAdminPage(): AdminPageHandle {
  let state: AdminPageState = initial;
  const root = h("main", { class: "admin-root" });
  const electionInput = h("input", { type: "text", placeholder: "0x… election id (32-byte hex)", "data-testid": "election-id" });
  const schemaSelect = h("select", { "data-testid": "schema-id" });
  for (const opt of ["PUBLIC_SCHEMA_V1_R0", "PUBLIC_SCHEMA_V1_R1"]) {
    const o = h("option", { value: opt }, [opt]);
    schemaSelect.appendChild(o);
  }
  const optionsInput = h("input", { type: "number", min: "1", max: "16", value: "5", "data-testid": "option-count" });
  const submit = h("button", { type: "button", "data-testid": "open-election" }, ["Open election (requires contract id)"]);
  const status = h("p", { class: "admin-status", "data-testid": "status" }, [state.message]);
  const manifestList = h("ul", { class: "admin-manifest" });

  root.appendChild(h("h1", {}, ["ZK-Quorum · Admin"]));
  root.appendChild(h("p", {}, [
    "Admins open elections by sending a transaction to the deployed contract. This scaffold renders the form and validates inputs locally; signing/submission is delegated to the operator wallet extension.",
  ]));
  root.appendChild(h("label", {}, ["Election id", electionInput]));
  root.appendChild(h("label", {}, ["Public schema", schemaSelect]));
  root.appendChild(h("label", {}, ["Option count", optionsInput]));
  root.appendChild(submit);
  root.appendChild(status);
  root.appendChild(h("h2", {}, ["Manifest (read-only)"]));
  root.appendChild(manifestList);

  const update = () => {
    status.textContent = state.message;
    submit.setAttribute("disabled", state.status === "submitting" ? "true" : "false");
  };
  update();

  return {
    root,
    getState(): AdminPageState {
      return {
        ...state,
        electionId: (electionInput as unknown as { value: string }).value,
        schemaId: (schemaSelect as unknown as { value: string }).value,
        optionCount: Number.parseInt((optionsInput as unknown as { value: string }).value, 10),
      };
    },
    setState(next: AdminPageState) {
      state = next;
      update();
    },
    onOpen(listener: (s: AdminPageState) => void | Promise<void>) {
      submit.addEventListener("click", () => { void listener(this.getState()); });
    },
  };
}
