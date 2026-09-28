import type { BriefInitiativeRef, PortfolioBrief } from "@scry/shared";

type Facts = Omit<PortfolioBrief, "summary">;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The brief's opening, written from its own figures so it reads without AI:
 * the period in one line, then up to three things that need attention —
 * duplicates first, then uncommitted demand, work at risk, and emerging
 * themes. Plain sentences, no numbers the figures don't contain.
 */
export function briefSummary(brief: Facts, teamName: (id: string) => string): string[] {
  const t = brief.totals;
  const name = (r: BriefInitiativeRef) => `“${r.title}” (${teamName(r.teamId)})`;
  const lines: string[] = [];

  if (brief.days) {
    const before =
      t.newPreviousPeriod !== null ? ` (${t.newPreviousPeriod} the ${brief.days} days before)` : "";
    lines.push(
      `${plural(t.newInPeriod, "new initiative")} in the last ${brief.days} days${before}; ` +
        `${t.shippedInPeriod} shipped.`,
    );
  } else {
    lines.push(
      `${plural(t.live, "live initiative")} across ${plural(brief.teams.length, "team")}.`,
    );
  }

  const findings: string[] = [];
  const [dup] = brief.overlaps;
  // The list is capped (strongest first); the total is in the figures.
  const duplicates = Math.max(t.openOverlaps, brief.overlaps.length);
  if (dup) {
    findings.push(
      duplicates === 1
        ? `${name(dup.a)} and ${name(dup.b)} look like the same work; nobody has decided yet.`
        : `${duplicates} possible duplicates across teams, led by ${name(dup.a)} and ${name(dup.b)}.`,
    );
  }
  const top = brief.wanted.find((w) => w.teams >= 2);
  if (top) {
    findings.push(
      `${name(top.initiative)} is wanted by ${plural(top.teams, "other team")}` +
        (top.uncommitted ? ", but nobody has committed to it yet." : "."),
    );
  }
  const risk = brief.decisions.find((d) => d.kind === "at_risk");
  if (risk) {
    const why = risk.initiative.status === "on_hold" ? "is on hold" : "has gone quiet";
    findings.push(
      `${name(risk.initiative)} ${why} while ${plural(risk.value, "other team")} ${risk.value === 1 ? "builds" : "build"} on it.`,
    );
  }
  const theme = brief.emerging.find((e) => e.separate);
  if (theme) {
    findings.push(
      `${plural(theme.teamIds.length, "team")} started work on ${theme.tag} separately${brief.days ? " this period" : ""}.`,
    );
  }

  if (findings.length === 0) findings.push("Nothing needs a decision right now.");
  return [...lines, ...findings.slice(0, 3)];
}
