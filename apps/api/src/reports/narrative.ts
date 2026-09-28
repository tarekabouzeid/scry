import { z } from "zod";
import type { BriefInitiativeRef, PortfolioBrief } from "@scry/shared";

export const narrativeSchema = z.object({
  headline: z.string().describe("One sentence, at most 20 words, with a number."),
  points: z
    .array(
      z.object({
        text: z.string().describe("One sentence, at most 35 words."),
        initiativeIds: z
          .array(z.string())
          .describe("Ids (from the facts) of the initiatives this point is about."),
      }),
    )
    .describe("Two to four points, most important first."),
});

export const NARRATIVE_SYSTEM = `You write the opening of a portfolio brief for a CIO, CTO or strategy lead.
The brief covers an organisation's idea bank: what teams are proposing, where they may be building the same thing, what other teams want and nobody has picked up, work many teams build on that has stalled, and what changed. It is not a delivery report.
The reader has thirty seconds and will act on what you write.

Rules:
- Use only the facts provided. Never invent numbers, names, causes, dates or outcomes.
- headline: the single most important thing, one sentence, at most 20 words, with a number from the facts.
- points: two to four, most important first. Each is one sentence of at most 35 words: the fact, the teams involved, and the decision or conversation it calls for (name the contact person when the facts give one).
- Cite, in initiativeIds, the ids of the initiatives each point is about. Every point must cite at least one.
- Refer to initiatives and teams by name, never by id.
- Plain business English. No filler, no hedging, no praise, no adjectives such as "exciting", "robust", "significant" or "key".
  Do not restate the headline. Do not start with "Overall" or "In summary". No emojis, no markdown.
- If nothing needs a decision, say that plainly in the headline and use the points for what is emerging.`;

/** The brief as compact, labelled lines — ids in brackets so the model can cite them. */
export function narrativePrompt(brief: PortfolioBrief): string {
  const team = new Map(brief.teams.map((t) => [t.teamId, t.name]));
  const teamName = (id: string) => team.get(id) ?? "another team";
  const i = (r: BriefInitiativeRef) =>
    `"${r.title}" [${r.id}] (${teamName(r.teamId)}${r.contactName ? `, contact ${r.contactName}` : ""})`;
  const status = (s: string) => s.replace("_", " ");
  const t = brief.totals;
  const period = brief.days ? `the last ${brief.days} days` : "all time";
  const none = (xs: string[]) => (xs.length ? xs : ["- none"]);
  const lines: string[] = [
    `Scope: ${brief.orgUnit ?? "whole organisation"}; period: ${period}.`,
    `Totals: ${t.live} live initiatives across ${brief.teams.length} teams; ${t.byStatus.idea} ideas, ${t.byStatus.planned} planned, ${t.byStatus.in_progress} in progress, ${t.byStatus.on_hold} on hold, ${t.byStatus.shipped} shipped; ${t.strategic} strategic.`,
    `In the period: ${t.newInPeriod} new${t.newPreviousPeriod !== null ? ` (previous period: ${t.newPreviousPeriod})` : ""}, ${t.shippedInPeriod} shipped. Possible duplicates: ${t.openOverlaps}. Gone quiet: ${t.goneQuiet}.`,
    "",
    "Possible duplicates:",
    ...none(
      brief.overlaps
        .slice(0, 5)
        .map((o) => `- ${i(o.a)} and ${i(o.b)}: ${Math.round(o.score * 100)}% similar.`),
    ),
    "",
    "Wanted by other teams (asked, or building on it):",
    ...none(
      brief.wanted.slice(0, 5).map((w) => {
        const by = w.wants
          .filter((x) => !x.stale)
          .map((x) =>
            x.how === "asked"
              ? `${teamName(x.teamId)} asked${x.reason ? ` ("${x.reason}")` : ""}`
              : `${teamName(x.teamId)} builds on it`,
          );
        return `- ${i(w.initiative)}, status ${status(w.initiative.status)}: wanted by ${w.teams} team(s): ${by.join("; ")}.${w.uncommitted ? " Nobody has committed to it." : ""}`;
      }),
    ),
    "",
    "Built on by other teams, but on hold or gone quiet:",
    ...none(
      brief.decisions
        .filter((d) => d.kind === "at_risk")
        .map(
          (d) =>
            `- ${i(d.initiative)}, status ${status(d.initiative.status)}: built on by ${d.teamIds.map(teamName).join(", ")}.`,
        ),
    ),
    "",
    "Emerging themes (new work, by number of teams):",
    ...none(
      brief.emerging.map(
        (th) =>
          `- ${[th.tag, ...th.related].join(" / ")}: ${th.count} initiative(s) across ${th.teamIds.map(teamName).join(", ")}; e.g. ${th.initiatives.slice(0, 2).map(i).join("; ")}.`,
      ),
    ),
    "",
    "Changed in the period:",
    ...none(
      brief.changes.slice(0, 8).map((c) => {
        const what =
          c.kind === "moved"
            ? `moved from ${status(c.from ?? "")} to ${status(c.initiative.status)}`
            : c.kind === "wanted"
              ? `newly wanted by ${teamName(c.teamId ?? "")}`
              : c.kind === "shipped"
                ? "shipped"
                : `duplicate check with ${c.other ? i(c.other) : "another initiative"}: ${c.kind}`;
        return `- ${i(c.initiative)}: ${what}.`;
      }),
    ),
    "",
    `Gone quiet (planned or in progress, no update for 45+ days):`,
    ...none(
      brief.stale
        .slice(0, 5)
        .map((s) => `- ${i(s.initiative)}, last update ${s.updatedAt.slice(0, 10)}.`),
    ),
  ];
  return `Facts:\n${lines.join("\n")}\n\nWrite the headline and points.`;
}

/** Every initiative the facts mention, so cited ids can be checked against them. */
export function citableIds(brief: PortfolioBrief): Set<string> {
  const known = new Set<string>();
  const add = (r?: BriefInitiativeRef) => r && known.add(r.id);
  brief.newest.forEach(add);
  brief.emerging.forEach((t) => t.initiatives.forEach(add));
  brief.overlaps.forEach((o) => [o.a, o.b].forEach(add));
  brief.wanted.forEach((w) => [w.initiative, ...w.wants.map((x) => x.via)].forEach(add));
  brief.decisions.forEach((d) => [d.initiative, d.other].forEach(add));
  brief.changes.forEach((c) => [c.initiative, c.other].forEach(add));
  brief.stale.forEach((s) => add(s.initiative));
  return known;
}
