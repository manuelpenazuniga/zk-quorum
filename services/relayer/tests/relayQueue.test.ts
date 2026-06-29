import { describe, it, expect } from "vitest";
import { createPerAccountRelayQueue } from "../src/services/relayQueue.js";

describe("relayQueue", () => {
  it("runs tasks within concurrency", async () => {
    const q = createPerAccountRelayQueue<number>({ concurrency: 2 });
    let running = 0;
    let max = 0;
    const task = (id: number) => q.submit({
      id: "acc",
      run: async () => {
        running += 1;
        max = Math.max(max, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
        return id;
      },
    });
    const results = await Promise.all([task(1), task(2), task(3), task(4)]);
    expect(results.sort()).toEqual([1, 2, 3, 4]);
    expect(max).toBeLessThanOrEqual(2);
  });

  it("isolates lanes per account", async () => {
    const q = createPerAccountRelayQueue<number>({ concurrency: 1 });
    const order: string[] = [];
    const mk = (lane: string, n: number) => q.submit({
      id: lane,
      run: async () => {
        order.push(`${lane}:${n}`);
        await new Promise((r) => setTimeout(r, 1));
        return n;
      },
    });
    await Promise.all([mk("a", 1), mk("b", 1), mk("a", 2), mk("b", 2)]);
    expect(order).toContain("a:1");
    expect(order).toContain("b:1");
  });

  it("propagates errors", async () => {
    const q = createPerAccountRelayQueue<string>({ concurrency: 1 });
    await expect(q.submit({
      id: "x",
      run: async () => { throw new Error("nope"); },
    })).rejects.toThrow("nope");
  });

  it("drain resolves when empty", async () => {
    const q = createPerAccountRelayQueue<number>({ concurrency: 1 });
    await q.drain();
    expect(q.size()).toBe(0);
    expect(q.inFlight()).toBe(0);
  });

  it("rejects invalid concurrency", () => {
    expect(() => createPerAccountRelayQueue({ concurrency: 0 })).toThrow();
  });
});
