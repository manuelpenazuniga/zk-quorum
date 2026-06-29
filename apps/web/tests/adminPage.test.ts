import { describe, it, expect } from "vitest";
import { createAdminPage, type AdminPageState } from "../src/admin/adminPage.js";

describe("admin page", () => {
  it("renders the title and form", () => {
    const page = createAdminPage();
    expect(page.root.querySelector("h1")?.textContent).toBe("ZK-Quorum · Admin");
    expect(page.root.querySelector("[data-testid='election-id']")).toBeTruthy();
    expect(page.root.querySelector("[data-testid='open-election']")).toBeTruthy();
  });

  it("captures the election id from the form", () => {
    const page = createAdminPage();
    const states: AdminPageState[] = [];
    page.onOpen(async (s: AdminPageState) => { states.push(s); });
    (page.root.querySelector<HTMLInputElement>("[data-testid='election-id']")!).value = "0x" + "ab".repeat(32);
    const btn = page.root.querySelector<HTMLButtonElement>("[data-testid='open-election']")!;
    btn.dispatchEvent(new Event("click", { bubbles: true }));
    expect(states.length).toBe(1);
    expect(states[0]!.electionId).toBe("0x" + "ab".repeat(32));
  });
});
