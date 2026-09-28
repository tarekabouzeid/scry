import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { clampHops, pickNeighbourhood, relatedInitiativesQuery } from "./graph";

const dialect = new PgDialect();
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

describe("relatedInitiativesQuery", () => {
  it("binds seeds and types as arrays and inlines nothing user-supplied", () => {
    const q = dialect.sqlToQuery(relatedInitiativesQuery([A, B], ["builds_on", "related"], 2));
    expect(q.params).toContain(`{${A},${B}}`);
    expect(q.params).toContain("{builds_on,related}");
    expect(q.params).toContain(2);
    expect(q.sql).not.toContain(A);
    expect(q.sql).toMatch(/with recursive walk/);
    // Both directions, a cycle guard, and one row per node from the earliest seed.
    expect(q.sql).toMatch(/where e\.from_initiative_id = w\.node/);
    expect(q.sql).toMatch(/where e\.to_initiative_id = w\.node/);
    expect(q.sql).toMatch(/n\.other <> all\(w\.path\)/);
    expect(q.sql).toMatch(/distinct on \(node\)[\s\S]*order by node, ord, hops/);
  });

  it("never walks further than two steps", () => {
    const q = dialect.sqlToQuery(relatedInitiativesQuery([A], ["related"], 9));
    expect(q.params).toContain(2);
    expect(q.params).not.toContain(9);
  });
});

describe("clampHops", () => {
  it("keeps hops between 1 and 2", () => {
    expect(clampHops(0)).toBe(1);
    expect(clampHops(1)).toBe(1);
    expect(clampHops(2.7)).toBe(2);
    expect(clampHops(5)).toBe(2);
    expect(clampHops(Number.NaN)).toBe(1);
  });
});

describe("pickNeighbourhood", () => {
  const related = [
    { id: "far", hops: 2, throughId: A },
    { id: "near2", hops: 1, throughId: A },
    { id: "near1", hops: 1, throughId: B },
  ];

  it("puts seeds first, then the nearest work", () => {
    expect(pickNeighbourhood([A, B], related, 300)).toEqual({
      ids: [A, B, "near1", "near2", "far"],
      truncated: false,
    });
  });

  it("caps the result and says so", () => {
    expect(pickNeighbourhood([A], related, 3)).toEqual({
      ids: [A, "near1", "near2"],
      truncated: true,
    });
  });

  it("doesn't count a seed twice", () => {
    expect(pickNeighbourhood([A, A], [], 1)).toEqual({ ids: [A], truncated: false });
  });
});
