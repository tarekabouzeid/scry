import { describe, expect, it } from "vitest";
import { normalizeTags } from "./tags";
import { orderPair } from "../overlaps/pair";
import { canEditInitiative, canRelateInitiative } from "./permissions";
import { throttleKey } from "./throttle";
import { changedPaths } from "../audit/diff";
import { repointEdges } from "../initiatives/merge.service";
import type { AuthenticatedUser } from "../auth/types";

describe("normalizeTags", () => {
  it("trims, lowercases, drops empties and de-duplicates", () => {
    expect(normalizeTags([" AI ", "ai", "", "Infra", "design system"])).toEqual([
      "ai",
      "infra",
      "design system",
    ]);
  });
});

describe("orderPair", () => {
  it("is order-independent so each pair maps to one row", () => {
    expect(orderPair("b", "a")).toEqual(["a", "b"]);
    expect(orderPair("a", "b")).toEqual(["a", "b"]);
  });
});

describe("canEditInitiative", () => {
  const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
    ({ id: "u1", role: "member", teamId: "t1", teamAdmin: false, ...over }) as AuthenticatedUser;
  const init = { submittedBy: "someone", contactPerson: "someone", teamId: "t1" };
  it("lets a team admin edit their team's work, but not other teams'", () => {
    expect(canEditInitiative(user({ teamAdmin: true }), init)).toBe(true);
    expect(canEditInitiative(user({ teamAdmin: true }), { ...init, teamId: "t2" })).toBe(false);
    expect(canEditInitiative(user(), init)).toBe(false);
  });
});

describe("canRelateInitiative", () => {
  const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
    ({ id: "u1", role: "member", teamId: "t1", ...over }) as AuthenticatedUser;
  const init = (over: Record<string, string | null> = {}) => ({
    submittedBy: "someone",
    contactPerson: "someone",
    teamId: "t2",
    ...over,
  });
  it("allows owners, team members and admins", () => {
    expect(canRelateInitiative(user(), init({ submittedBy: "u1" }))).toBe(true);
    expect(canRelateInitiative(user(), init({ contactPerson: "u1" }))).toBe(true);
    expect(canRelateInitiative(user(), init({ teamId: "t1" }))).toBe(true);
    expect(canRelateInitiative(user({ role: "admin" }), init())).toBe(true);
  });
  it("refuses everyone else, including teamless users", () => {
    expect(canRelateInitiative(user(), init())).toBe(false);
    expect(canRelateInitiative(user({ teamId: null }), init({ teamId: null as never }))).toBe(
      false,
    );
  });
});

describe("throttleKey", () => {
  it("keys on a hash of the credential, never the raw token", () => {
    const key = throttleKey({ headers: { authorization: "Bearer scry_pat_abc" }, ip: "1.2.3.4" });
    expect(key).toMatch(/^cred:[0-9a-f]{32}$/);
    expect(key).not.toContain("scry_pat_abc");
  });
  it("uses the session cookie, then falls back to the IP", () => {
    const a = throttleKey({ headers: {}, cookies: { scry_session: "x" }, ip: "1.2.3.4" });
    const b = throttleKey({ headers: {}, cookies: { scry_session: "y" }, ip: "1.2.3.4" });
    expect(a).not.toBe(b);
    expect(throttleKey({ headers: {}, ip: "1.2.3.4" })).toBe("ip:1.2.3.4");
  });
});

describe("changedPaths", () => {
  it("lists the dotted paths that differ, never whole objects", () => {
    const before = { a: 1, b: { c: "x", d: [1, 2] }, e: { f: true } };
    const after = { a: 1, b: { c: "y", d: [1, 2, 3] }, e: { f: true }, g: null };
    expect(changedPaths(before, after)).toEqual(["b.c", "b.d", "g"]);
    expect(changedPaths(before, structuredClone(before))).toEqual([]);
  });
});

describe("repointEdges (merging)", () => {
  const e = (id: string, from: string, to: string, type = "builds_on") =>
    ({ id, fromInitiativeId: from, toInitiativeId: to, type }) as Parameters<
      typeof repointEdges
    >[0][number];
  it("moves the duplicate's relationships to the survivor, dropping loops and repeats", () => {
    const { moved, dropped } = repointEdges(
      [
        e("1", "S", "X"), // S→X becomes T→X
        e("2", "Y", "S"), // Y→S becomes Y→T
        e("3", "S", "T"), // would be T→T: dropped
        e("4", "T", "Z"), // untouched
        e("5", "S", "Z"), // T→Z already exists: dropped
        e("6", "Z", "S", "related"), // T and Z are already related, whatever the type: dropped
      ],
      "S",
      "T",
    );
    expect(moved.map((m) => [m.edge.id, m.from, m.to])).toEqual([
      ["1", "T", "X"],
      ["2", "Y", "T"],
    ]);
    expect(dropped.map((d) => d.id)).toEqual(["3", "5", "6"]);
  });

  it("drops relationships that would end up inside one team", () => {
    const team: Record<string, string> = { S: "growth", T: "data", X: "data", Y: "payments" };
    const { moved, dropped } = repointEdges(
      [e("1", "S", "X"), e("2", "Y", "S")],
      "S",
      "T",
      (id) => team[id],
    );
    expect(dropped.map((d) => d.id)).toEqual(["1"]); // T→X: both Data & ML
    expect(moved.map((m) => [m.edge.id, m.from, m.to])).toEqual([["2", "Y", "T"]]);
  });
});
