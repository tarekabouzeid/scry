import { describe, expect, it } from "vitest";
import { initialAdminEmails } from "./user.service";

describe("initialAdminEmails", () => {
  it("reads a comma-separated list, case-insensitively", () => {
    expect([...initialAdminEmails(" Alice@Example.com, ops@example.com ,")]).toEqual([
      "alice@example.com",
      "ops@example.com",
    ]);
  });

  it("is empty when unset: nobody becomes admin just by signing in", () => {
    expect(initialAdminEmails(undefined).size).toBe(0);
    expect(initialAdminEmails("").size).toBe(0);
  });
});
