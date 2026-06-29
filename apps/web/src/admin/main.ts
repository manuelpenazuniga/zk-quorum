import { createAdminPage } from "./adminPage.js";
import { mount } from "../shared/dom.js";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("missing #app root");
}
const page = createAdminPage();
mount(target, page.root);
page.onOpen(async (s) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(s.electionId)) {
    page.setState({ ...s, status: "error", message: "electionId must be 32-byte hex" });
    return;
  }
  if (!Number.isInteger(s.optionCount) || s.optionCount < 1 || s.optionCount > 16) {
    page.setState({ ...s, status: "error", message: "optionCount must be 1..16" });
    return;
  }
  page.setState({ ...s, status: "submitting", message: "No signer connected in this scaffold. Wire the operator wallet before deploying." });
});
