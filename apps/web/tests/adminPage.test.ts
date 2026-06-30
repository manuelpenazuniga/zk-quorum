import { describe, it, expect } from "vitest";
import { createAdminPage, type AdminPageState } from "../src/admin/adminPage.js";

describe("admin page (audit C2)", () => {
  it("renders the title and form", () => {
    const page = createAdminPage();
    expect(page.root.querySelector("h1")?.textContent).toBe("ZK-Quorum · Admin");
    expect(page.root.querySelector("[data-testid='election-id']")).toBeTruthy();
    expect(page.root.querySelector("[data-testid='open-election']")).toBeTruthy();
  });

  it("uses IDL `disabled` property on the submit button", () => {
    const page = createAdminPage();
    const btn = page.root.querySelector<HTMLButtonElement>("[data-testid='open-election']")!;
    expect(btn.disabled).toBe(false);
    page.setState({ status: "submitting", electionId: "0x" + "ab".repeat(32), schemaId: "PUBLIC_SCHEMA_V1_R0", optionCount: 5, message: "submitting" });
    expect(btn.disabled).toBe(true);
    page.setState({ status: "submitted", electionId: "0x" + "ab".repeat(32), schemaId: "PUBLIC_SCHEMA_V1_R0", optionCount: 5, message: "submitted" });
    expect(btn.disabled).toBe(false);
  });

  it("real .click() invokes the open listener; disabled button does not", async () => {
    const page = createAdminPage();
    const states: AdminPageState[] = [];
    page.onOpen(async (s: AdminPageState) => { states.push(s); });
    const btn = page.root.querySelector<HTMLButtonElement>("[data-testid='open-election']")!;
    (page.root.querySelector<HTMLInputElement>("[data-testid='election-id']")!).value = "0x" + "ab".repeat(32);
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(states.length).toBe(1);

    page.setState({ status: "submitting", electionId: "0x" + "ab".repeat(32), schemaId: "PUBLIC_SCHEMA_V1_R0", optionCount: 5, message: "submitting" });
    expect(btn.disabled).toBe(true);
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    // The listener was called once. A disabled button is click()-no-op.
    expect(states.length).toBe(1);
  });
});
