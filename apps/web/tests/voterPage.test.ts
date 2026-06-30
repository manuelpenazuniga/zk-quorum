import { describe, it, expect } from "vitest";
import { createVoterPage } from "../src/app/voterPage.js";

describe("voter page (audit C2)", () => {
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

  it("uses IDL `disabled` property (not a string attribute) and toggles it on state", () => {
    const page = createVoterPage();
    const btn = page.root.querySelector<HTMLButtonElement>("[data-testid='cast']")!;
    expect(btn.disabled).toBe(false);
    page.setState({ status: "proving", message: "p", txHash: null, proofHash: null, publicSignalsHash: null });
    expect(btn.disabled).toBe(true);
    page.setState({ status: "submitting", message: "s", txHash: null, proofHash: null, publicSignalsHash: null });
    expect(btn.disabled).toBe(true);
    page.setState({ status: "idle", message: "i", txHash: null, proofHash: null, publicSignalsHash: null });
    expect(btn.disabled).toBe(false);
  });

  it("real .click() invokes the cast listener; disabled button is click()-no-op", async () => {
    const page = createVoterPage();
    let called = 0;
    page.onCast(() => { called += 1; });
    const btn = page.root.querySelector<HTMLButtonElement>("[data-testid='cast']")!;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(called).toBe(1);

    page.setState({ status: "proving", message: "p", txHash: null, proofHash: null, publicSignalsHash: null });
    expect(btn.disabled).toBe(true);
    // Browsers (and jsdom) fire no click event on a disabled button via .click().
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(called).toBe(1);
  });
});
