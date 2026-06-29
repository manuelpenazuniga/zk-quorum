import { describe, it, expect } from "vitest";
import { createVoterPage } from "../src/app/voterPage.js";

describe("voter page", () => {
  it("renders the title and CTA", () => {
    const page = createVoterPage();
    expect(page.root.querySelector("h1")?.textContent).toBe("ZK-Quorum · Voter");
    const btn = page.root.querySelector<HTMLButtonElement>("[data-testid='cast']");
    expect(btn?.textContent).toBe("Cast ballot");
  });

  it("updates the status line", () => {
    const page = createVoterPage();
    page.setState({ status: "proving", message: "hi", txHash: null, proofHash: null, publicSignalsHash: null });
    expect(page.root.querySelector("[data-testid='status']")?.textContent).toBe("hi");
  });

  it("invokes the cast listener", async () => {
    const page = createVoterPage();
    let called = 0;
    page.onCast(() => { called += 1; });
    const btn = page.root.querySelector<HTMLButtonElement>("[data-testid='cast']")!;
    btn.dispatchEvent(new Event("click", { bubbles: true }));
    expect(called).toBe(1);
  });
});
