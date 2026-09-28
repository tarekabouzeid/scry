import { describe, expect, it } from "vitest";
import type { BriefInitiativeRef, PortfolioBrief } from "@scry/shared";
import { briefSummary } from "./summary";

const ref = (id: string, title: string, teamId: string, status = "idea"): BriefInitiativeRef =>
  ({ id, title, teamId, status, tier: "tactical", contactName: null }) as BriefInitiativeRef;

const TEAMS: Record<string, string> = { g: "Growth", d: "Data & ML", p: "Payments" };
const teamName = (id: string) => TEAMS[id] ?? "another team";

function brief(over: Partial<PortfolioBrief> = {}): Omit<PortfolioBrief, "summary"> {
  return {
    generatedAt: "",
    days: 30,
    since: "",
    orgUnit: null,
    orgUnits: [],
    totals: {
      live: 12,
      byStatus: { idea: 0, planned: 0, in_progress: 0, on_hold: 0, shipped: 0, cancelled: 0 },
      strategic: 0,
      newInPeriod: 5,
      newPreviousPeriod: 2,
      shippedInPeriod: 1,
      openOverlaps: 0,
      goneQuiet: 0,
    },
    decisions: [],
    emerging: [],
    newest: [],
    wanted: [],
    changes: [],
    teams: [],
    overlaps: [],
    stale: [],
    ...over,
  };
}

describe("briefSummary", () => {
  it("opens with the period and says so when nothing needs a decision", () => {
    expect(briefSummary(brief(), teamName)).toEqual([
      "5 new initiatives in the last 30 days (2 the 30 days before); 1 shipped.",
      "Nothing needs a decision right now.",
    ]);
  });

  it("covers all time without a comparison", () => {
    const [first] = briefSummary(
      brief({ days: null, teams: [{} as never, {} as never] }),
      teamName,
    );
    expect(first).toBe("12 live initiatives across 2 teams.");
  });

  it("puts duplicates, uncommitted demand, risk and themes in that order, at most three", () => {
    const dash = ref("1", "Dashboards", "g");
    const store = ref("2", "Feature store", "d", "on_hold");
    const lines = briefSummary(
      brief({
        overlaps: [
          {
            id: "o",
            score: 0.9,
            a: dash,
            b: ref("3", "Self-serve dashboards", "d"),
            detectedAt: "",
          },
        ],
        wanted: [{ initiative: store, teams: 3, wants: [], uncommitted: true }],
        decisions: [{ kind: "at_risk", initiative: store, teamIds: ["g", "p"], value: 2 }],
        emerging: [
          {
            tag: "analytics",
            related: [],
            count: 3,
            newInPeriod: 3,
            teamIds: ["g", "d", "p"],
            initiatives: [],
            separate: true,
          },
        ],
      }),
      teamName,
    );
    expect(lines.slice(1)).toEqual([
      "“Dashboards” (Growth) and “Self-serve dashboards” (Data & ML) look like the same work; nobody has decided yet.",
      "“Feature store” (Data & ML) is wanted by 3 other teams, but nobody has committed to it yet.",
      "“Feature store” (Data & ML) is on hold while 2 other teams build on it.",
    ]);
  });

  it("ignores demand from a single team", () => {
    const lines = briefSummary(
      brief({
        wanted: [
          { initiative: ref("1", "Dark mode", "d"), teams: 1, wants: [], uncommitted: true },
        ],
      }),
      teamName,
    );
    expect(lines.at(-1)).toBe("Nothing needs a decision right now.");
  });
});
