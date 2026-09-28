import { beforeAll, describe, expect, it } from "vitest";
import { as, connectDemoLlm, initiativeId, resetDemo, sql, waitFor } from "../support/scry";

let passkeys: string;
let referral: string;

async function tldrOf(id: string) {
  const [row] = await sql<{ tldr: string | null; tldr_at: Date | null }[]>`
    select tldr, tldr_at from initiatives where id = ${id}`;
  return row!;
}

beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
  passkeys = await initiativeId("Passkeys for customer login");
  referral = await initiativeId("Referral program v2");
  await waitFor(async () => !!(await tldrOf(passkeys)).tldr, "TL;DRs to be written", 30_000);
});

describe("TL;DR", () => {
  it("is written in the background, from the summary, status and relationships", async () => {
    const { tldr } = await tldrOf(passkeys);
    expect(tldr).toContain("on hold: paused until Enterprise SSO's new session service is ready");
    expect(tldr).toContain("Referral program v2 (Growth) builds on it");
  });

  it("comes with the initiative, without its internal fingerprint", async () => {
    const { data } = await (await as("bob")).call("GET", `/initiatives/${passkeys}`);
    expect(data.tldr).toMatch(/^Passwordless login/);
    expect(data.tldrAt).toBeTruthy();
    expect(data).not.toHaveProperty("tldrSource");
  });

  it("is rewritten when something it mentions changes", async () => {
    // Once the referral programme ships, nothing open builds on passkeys any more.
    const alice = await as("alice");
    expect(
      (await alice.call("PATCH", `/initiatives/${referral}`, { status: "shipped" })).status,
    ).toBe(200);
    await waitFor(
      async () => !(await tldrOf(passkeys)).tldr?.includes("Referral program v2"),
      "the passkeys TL;DR to drop the referral programme",
      30_000,
    );
  });

  it("isn't rewritten when nothing it's written from changed", async () => {
    const before = await tldrOf(passkeys);
    const alice = await as("alice");
    await alice.call("PATCH", `/initiatives/${passkeys}`, {
      tags: ["passkeys", "webauthn", "login"],
    });
    await new Promise((r) => setTimeout(r, 5000));
    const after = await tldrOf(passkeys);
    expect(after.tldr).toBe(before.tldr);
    expect(after.tldr_at?.getTime()).toBe(before.tldr_at?.getTime());
  });
});
