import { describe, expect, it } from "vitest";
import { parseInitiativeIds, parseNeighbourhoodQuery } from "./graph-query";

const A = "7a1d1c1e-5c4b-4a53-9a51-0f5f3e7c2b10";
const B = "0b6f6a39-5a0e-4b61-8f0c-6f2d2a0f9e21";

describe("parseInitiativeIds", () => {
  it("splits, trims and dedupes", () => {
    expect(parseInitiativeIds(` ${A},${B},,${A} `)).toEqual([A, B]);
  });

  it("requires at least one id, at most 200, all ids", () => {
    expect(() => parseInitiativeIds(undefined)).toThrow("initiativeIds is required");
    expect(() => parseInitiativeIds("")).toThrow("initiativeIds is required");
    expect(() => parseInitiativeIds("nope")).toThrow("must be initiative ids");
    const many = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(() => parseInitiativeIds(many.join(","))).toThrow("At most 200");
    expect(parseInitiativeIds(many.slice(0, 200).join(","))).toHaveLength(200);
  });
});

describe("parseNeighbourhoodQuery", () => {
  it("defaults to one step and the 300 cap", () => {
    expect(parseNeighbourhoodQuery({ initiativeId: A })).toEqual({
      initiativeId: A,
      teamId: undefined,
      hops: 1,
      limit: 300,
    });
    expect(parseNeighbourhoodQuery({ teamId: B, hops: "2", limit: "50" })).toMatchObject({
      teamId: B,
      hops: 2,
      limit: 50,
    });
  });

  it("wants exactly one of initiativeId and teamId", () => {
    expect(() => parseNeighbourhoodQuery({})).toThrow("either initiativeId or teamId");
    expect(() => parseNeighbourhoodQuery({ initiativeId: A, teamId: B })).toThrow(
      "either initiativeId or teamId",
    );
    expect(() => parseNeighbourhoodQuery({ teamId: "growth" })).toThrow("must be ids");
  });

  it("refuses hops beyond two and limits beyond 300", () => {
    expect(() => parseNeighbourhoodQuery({ initiativeId: A, hops: "3" })).toThrow("hops");
    expect(() => parseNeighbourhoodQuery({ initiativeId: A, hops: "0" })).toThrow("hops");
    expect(() => parseNeighbourhoodQuery({ initiativeId: A, limit: "301" })).toThrow("limit");
    expect(() => parseNeighbourhoodQuery({ initiativeId: A, limit: "ten" })).toThrow("limit");
  });
});
