import { describe, expect, it } from "vitest";
import type { BriefInitiativeRef, PortfolioBrief } from "@scry/shared";
import { NARRATIVE_SYSTEM, citableIds, narrativePrompt, narrativeSchema } from "./narrative";

const ref = (id: string, title: string, teamId: string): BriefInitiativeRef => ({
  id,
  title,
  teamId,
  status: "in_progress",
  tier: "strategic",
  contactName: "Omar Haddad",
});

const status = { idea: 1, planned: 1, in_progress: 2, on_hold: 1, shipped: 0, cancelled: 0 };

const team = (teamId: string, name: string) => ({
  teamId,
  name,
  orgUnit: null,
  total: 2,
  byStatus: status,
  newInPeriod: 1,
  shippedInPeriod: 0,
  demandTeams: 0,
  openOverlaps: 0,
  lastActivityAt: null,
});

const pk = {
  ...ref("11111111-1111-1111-1111-111111111111", "Passkeys", "t-id"),
  status: "on_hold" as const,
};
const referral = ref("22222222-2222-2222-2222-222222222222", "Referral v2", "t-growth");

function brief(overrides: Partial<PortfolioBrief> = {}): PortfolioBrief {
  return {
    generatedAt: "2026-09-26T12:00:00.000Z",
    days: 90,
    since: "2026-06-28T12:00:00.000Z",
    orgUnit: null,
    orgUnits: [],
    summary: [],
    teams: [team("t-id", "Identity"), team("t-growth", "Growth")],
    totals: {
      live: 5,
      byStatus: status,
      strategic: 2,
      newInPeriod: 3,
      newPreviousPeriod: 1,
      shippedInPeriod: 0,
      openOverlaps: 0,
      goneQuiet: 0,
    },
    decisions: [{ kind: "at_risk", initiative: pk, teamIds: ["t-growth"], value: 1 }],
    emerging: [],
    newest: [],
    wanted: [
      {
        initiative: pk,
        teams: 1,
        uncommitted: true,
        wants: [
          {
            teamId: "t-growth",
            how: "builds_on",
            reason: "Referral v2",
            via: referral,
            at: "2026-09-01T00:00:00.000Z",
            stale: false,
          },
        ],
      },
    ],
    changes: [],
    overlaps: [],
    stale: [],
    ...overrides,
  };
}

describe("brief summary prompt", () => {
  it("lists the facts with citable ids, team names and contacts", () => {
    const prompt = narrativePrompt(brief());
    expect(prompt).toContain(
      '"Passkeys" [11111111-1111-1111-1111-111111111111] (Identity, contact Omar Haddad)',
    );
    expect(prompt).toContain(
      "wanted by 1 team(s): Growth builds on it. Nobody has committed to it.",
    );
    expect(prompt).toContain("status on hold: built on by Growth.");
    expect(prompt).toContain("3 new (previous period: 1)");
    expect(prompt).toContain("the last 90 days");
  });

  it("says 'none' for empty sections rather than leaving the model to guess", () => {
    const prompt = narrativePrompt(brief({ decisions: [], wanted: [] }));
    expect(prompt).toMatch(/Built on by other teams, but on hold or gone quiet:\n- none/);
    expect(prompt).toMatch(/Possible duplicates:\n- none/);
  });

  it("describes all-time and org-unit scopes", () => {
    const prompt = narrativePrompt(brief({ days: null, orgUnit: "Engineering" }));
    expect(prompt).toContain("Scope: Engineering; period: all time.");
  });

  it("accepts citations of anything the facts mention, including the work building on it", () => {
    const ids = citableIds(brief());
    expect(ids.has(pk.id)).toBe(true);
    expect(ids.has(referral.id)).toBe(true);
    expect(ids.has("33333333-3333-3333-3333-333333333333")).toBe(false);
  });

  it("forbids invention and filler, and isn't a delivery report", () => {
    expect(NARRATIVE_SYSTEM).toMatch(/Never invent/);
    expect(NARRATIVE_SYSTEM).toMatch(/never by id/);
    expect(NARRATIVE_SYSTEM).toMatch(/not a delivery report/);
    expect(narrativeSchema.safeParse({ headline: "x", points: [] }).success).toBe(true);
  });
});
