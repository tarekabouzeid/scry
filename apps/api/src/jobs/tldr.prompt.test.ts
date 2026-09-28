import { describe, expect, it } from "vitest";
import { TLDR_SYSTEM, tldrPrompt, tldrSource, type TldrInput } from "./tldr.prompt";

const input: TldrInput = {
  title: "Passkeys for customer login",
  summary: "Passwordless login for customers\nusing passkeys.",
  status: "on_hold",
  tier: "tactical",
  team: "Identity & Security",
  holdReason: "Waiting for the new session service",
  buildsOn: [],
  builtOnBy: ["Referral program v2 (Growth)"],
  askedForBy: [],
};

describe("TL;DR prompt", () => {
  it("lists the facts, including which other teams connect to it", () => {
    const p = tldrPrompt(input);
    expect(p).toContain("Status: on hold (Waiting for the new session service)");
    expect(p).toContain("Summary: Passwordless login for customers using passkeys.");
    expect(p).toContain("Builds on: none");
    expect(p).toContain("Built on by: Referral program v2 (Growth)");
    expect(p).toContain("Asked for by: none");
  });

  it("fingerprints the inputs, so unchanged facts don't cost a model call", () => {
    expect(tldrSource(input)).toBe(tldrSource({ ...input }));
    expect(tldrSource(input)).not.toBe(tldrSource({ ...input, status: "in_progress" }));
    expect(tldrSource(input)).not.toBe(tldrSource({ ...input, builtOnBy: [] }));
    expect(tldrSource(input)).not.toBe(tldrSource({ ...input, holdReason: null }));
  });

  it("keeps the model to the facts and to one short sentence", () => {
    expect(TLDR_SYSTEM).toMatch(/at most 25 words/);
    expect(TLDR_SYSTEM).toMatch(/Never invent/);
  });
});
