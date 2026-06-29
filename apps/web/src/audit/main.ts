import { createAuditPage } from "./auditPage.js";
import { mount } from "../shared/dom.js";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("missing #app root");
}
const page = createAuditPage();
mount(target, page.root);
page.onLoad(async (file) => {
  page.setState({ status: "loading", message: "Reading bundle…", summary: null });
  try {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") {
      page.setState({ status: "error", message: "bundle must be a JSON object", summary: null });
      return;
    }
    const b = parsed as { schema?: unknown; electionId?: unknown; events?: unknown };
    if (b.schema !== "AUDIT_BUNDLE_V1") {
      page.setState({ status: "error", message: `expected schema AUDIT_BUNDLE_V1, got ${String(b.schema)}`, summary: null });
      return;
    }
    const summary = {
      schema: b.schema,
      electionId: b.electionId,
      eventCount: Array.isArray(b.events) ? b.events.length : 0,
    };
    page.setState({ status: "ready", message: "Bundle loaded. Run `zkq-auditor replay --bundle <path>` for full verification.", summary });
  } catch (e) {
    page.setState({ status: "error", message: e instanceof Error ? e.message : String(e), summary: null });
  }
});
