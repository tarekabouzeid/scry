import { beforeAll, describe, expect, it } from "vitest";
import { as, connectDemoLlm, resetDemo } from "../support/scry";

beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
});

const CHURN =
  "Account managers can't see which customers are about to churn until it's too late. We want a weekly churn risk list for account managers, so they can call at-risk customers before renewal.";

describe("writing help in the New initiative dialog", () => {
  it("drafts every field from a rough description", async () => {
    const { status, data } = await (
      await as("priya")
    ).call("POST", "/initiatives/assist", {
      mode: "draft",
      description: CHURN,
    });
    expect(status).toBe(201);
    expect(data.title).toBe("Weekly churn risk list for account managers");
    expect(data.summary).toContain("before renewal");
    expect(["strategic", "tactical"]).toContain(data.tier);
    expect(data.coverage).toEqual({ what: true, who: true, why: true });
    // Reuses the organisation's existing tags where they fit.
    expect(data.tags).toEqual(expect.arrayContaining(["churn", "risk"]));
    expect(data.tags.length).toBeLessThanOrEqual(5);
  });

  it("reviews a thin draft and says what's missing", async () => {
    const { data } = await (
      await as("priya")
    ).call("POST", "/initiatives/assist", {
      mode: "improve",
      title: "passkeys",
      summary: "Add passkeys to login.",
      tags: [],
    });
    expect(data.title).toBe("Passkeys");
    expect(data.coverage.who).toBe(false);
    expect(data.coverage.why).toBe(false);
  });

  it("needs something to work from", async () => {
    const priya = await as("priya");
    expect(
      (await priya.call("POST", "/initiatives/assist", { mode: "draft", description: "churn" }))
        .status,
    ).toBe(400);
    expect(
      (await priya.call("POST", "/initiatives/assist", { mode: "improve", title: "x" })).status,
    ).toBe(400);
    expect(
      (await priya.call("POST", "/initiatives/assist", { mode: "rewrite", description: CHURN }))
        .status,
    ).toBe(400);
  });

  it("explains itself when no model is connected", async () => {
    await (await as("alice")).call("DELETE", "/admin/llm");
    const r = await (
      await as("priya")
    ).call("POST", "/initiatives/assist", {
      mode: "draft",
      description: CHURN,
    });
    expect(r.status).toBe(503);
    await connectDemoLlm();
  });
});
