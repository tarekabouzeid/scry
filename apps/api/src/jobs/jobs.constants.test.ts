import { describe, expect, it } from "vitest";
import { chunk, concurrencyFrom } from "./jobs.constants";

describe("concurrencyFrom", () => {
  it("takes a positive whole number, else the default", () => {
    expect(concurrencyFrom("12", 8)).toBe(12);
    for (const bad of [undefined, "", "0", "-2", "2.5", "lots"]) {
      expect(concurrencyFrom(bad, 8)).toBe(8);
    }
  });
});

describe("chunk", () => {
  it("splits into batches of at most the size, in order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
});
