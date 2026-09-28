import { describe, expect, it } from "vitest";
import type { BriefInitiativeRef, BriefWant, PortfolioBrief } from "@scry/shared";
import { changeSentence, decisionSentence, wantsByTeam } from "./brief-text";

const ref = (title: string, teamId: string, contactName: string | null = null) =>
  ({
    id: title,
    title,
    teamId,
    status: "idea",
    tier: "tactical",
    contactName,
  }) as BriefInitiativeRef;
const TEAMS: Record<string, string> = { g: "Growth", d: "Data & ML", p: "Payments" };
const teamName = (id: string) => TEAMS[id] ?? "another team";
const flat = (segments: ReturnType<typeof changeSentence>) =>
  segments.map((s) => (typeof s === "string" ? s : `“${s.ref.title}”`)).join("");

describe("wantsByTeam", () => {
  it("gives a team that asks and builds on it one line", () => {
    const wants: BriefWant[] = [
      { teamId: "g", how: "asked", reason: "Churn features", at: "2026-09-10", stale: false },
      {
        teamId: "g",
        how: "builds_on",
        reason: "Emails",
        via: ref("Emails", "g"),
        at: "2026-09-01",
        stale: false,
      },
      { teamId: "p", how: "asked", reason: "Old", at: "2026-01-01", stale: true },
    ];
    expect(wantsByTeam(wants)).toEqual([
      {
        teamId: "g",
        text: "asked: “Churn features”; builds on it (Emails)",
        at: "2026-09-01",
        stale: false,
      },
      { teamId: "p", text: "asked: “Old”", at: "2026-01-01", stale: true },
    ]);
  });
});

describe("sentences", () => {
  it("name who to talk to on a decision", () => {
    const text = flat(
      decisionSentence(
        {
          kind: "duplicate",
          initiative: ref("Dashboards", "g", "Bob Martinez"),
          other: ref("Self-serve dashboards", "d", "Priya Shah"),
          teamIds: ["d"],
          value: 87,
        },
        { stale: [] } as unknown as PortfolioBrief,
        teamName,
      ),
    );
    expect(text).toBe(
      "“Dashboards” (Growth) and “Self-serve dashboards” (Data & ML) look like the same work, 87% similar. Talk to Bob Martinez and Priya Shah.",
    );
  });

  it("name the duplicate that was merged, and where it went", () => {
    const text = flat(
      changeSentence(
        {
          kind: "merged",
          initiative: ref("Dark theme", "g"),
          other: ref("Dark mode", "d"),
          at: "",
        },
        teamName,
      ),
    );
    expect(text).toBe("“Dark theme” (Growth) was merged into “Dark mode” (Data & ML).");
  });
});
