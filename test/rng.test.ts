import { describe, expect, it } from "vitest";
import { createRng } from "../src/sim/rng.js";

describe("createRng", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for a different seed", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("stays within [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() is inclusive on both ends", () => {
    const rng = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(0, 3));
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });

  it("sample() never returns more than the array length or requested n", () => {
    const rng = createRng(9);
    const arr = [1, 2, 3];
    expect(rng.sample(arr, 10)).toHaveLength(3);
    expect(rng.sample(arr, 2)).toHaveLength(2);
  });
});
