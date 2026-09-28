import type {
  BriefChange,
  BriefDecision,
  BriefInitiativeRef,
  BriefNarrative,
  BriefWant,
  PortfolioBrief,
} from "@scry/shared";
import { STATUS_META } from "./format";

/** A sentence as text runs and initiative references (rendered as links on screen). */
export type Segment = string | { ref: BriefInitiativeRef };

export const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 0, label: "All time" },
] as const;

export function periodPhrase(days: number | null): string {
  if (!days) return "all time";
  const p = PERIODS.find((x) => x.days === days);
  return `the last ${p?.label ?? `${days} days`}`;
}

export const DECISION_LABEL: Record<BriefDecision["kind"], string> = {
  duplicate: "Possible duplicate",
  uncommitted_demand: "Wanted, not picked up",
  at_risk: "Others build on it",
  gone_quiet: "Gone quiet",
};

/** "A", "A and B", "A, B and C". */
export function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const status = (r: BriefInitiativeRef) => STATUS_META[r.status].label.toLowerCase();
const daysAgo = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));

/** "Talk to Priya Shah." — the point of every decision is the conversation it starts. */
function talkTo(...refs: (BriefInitiativeRef | undefined)[]): string {
  const names = [...new Set(refs.map((r) => r?.contactName).filter(Boolean) as string[])];
  return names.length ? ` Talk to ${list(names)}.` : "";
}

export function decisionSentence(
  item: BriefDecision,
  brief: PortfolioBrief,
  teamName: (id: string) => string,
): Segment[] {
  const i = item.initiative;
  const owner = teamName(i.teamId);
  const teams = list(item.teamIds.map(teamName));
  switch (item.kind) {
    case "duplicate":
      return [
        { ref: i },
        ` (${owner}) and `,
        { ref: item.other! },
        ` (${teamName(item.other!.teamId)}) look like the same work, ${item.value}% similar.`,
        talkTo(i, item.other),
      ];
    case "uncommitted_demand":
      return [
        { ref: i },
        ` (${owner}) is wanted by ${teams}, but is still ${i.status === "idea" ? "an idea" : "on hold"}.`,
        talkTo(i),
      ];
    case "at_risk": {
      const quiet = brief.stale.find((s) => s.initiative.id === i.id);
      const why =
        i.status === "on_hold"
          ? "is on hold"
          : `has had no update in ${quiet ? daysAgo(quiet.updatedAt) : "45+"} days`;
      return [
        { ref: i },
        ` (${owner}) ${why}, and ${teams} ${item.value === 1 ? "builds" : "build"} on it.`,
        talkTo(i),
      ];
    }
    case "gone_quiet":
      return [
        { ref: i },
        ` (${owner}) is strategic and ${status(i)}, with no update in ${item.value} days. Is it still happening?`,
        talkTo(i),
      ];
  }
}

export function changeSentence(c: BriefChange, teamName: (id: string) => string): Segment[] {
  const i = c.initiative;
  const owner = teamName(i.teamId);
  switch (c.kind) {
    case "merged":
      return c.other
        ? [
            { ref: i },
            ` (${owner}) was merged into `,
            { ref: c.other },
            ` (${teamName(c.other.teamId)}).`,
          ]
        : ["A duplicate was merged into ", { ref: i }, ` (${owner}).`];
    case "linked":
      return c.other
        ? [{ ref: i }, " and ", { ref: c.other }, " were checked: related, not the same work."]
        : [{ ref: i }, " was checked: related to another initiative, not the same work."];
    case "dismissed":
      return c.other
        ? [{ ref: i }, " and ", { ref: c.other }, " were checked: not duplicates."]
        : [{ ref: i }, " was checked: not a duplicate."];
    case "moved":
      return [
        { ref: i },
        ` (${owner}) moved from ${STATUS_META[c.from!].label.toLowerCase()} to ${status(i)}.`,
      ];
    case "shipped":
      return [{ ref: i }, ` (${owner}) shipped.`];
    case "wanted":
      return [`${teamName(c.teamId!)} now wants `, { ref: i }, ` (${owner}).`];
  }
}

/** "asked: “needs it for fraud scoring”" or "builds on it (Merchant fraud scoring)". */
export function wantText(w: BriefWant): string {
  if (w.how === "builds_on") return `builds on it (${w.via?.title ?? w.reason ?? "their work"})`;
  return w.reason ? `asked: “${w.reason}”` : "asked";
}

/** A team's wants as one line: a team that asks and builds on it is one voice. */
export interface TeamWant {
  teamId: string;
  text: string;
  at: string;
  /** Every sign from this team is old and unconfirmed. */
  stale: boolean;
}

export function wantsByTeam(wants: BriefWant[]): TeamWant[] {
  const byTeam = new Map<string, BriefWant[]>();
  for (const w of wants) byTeam.set(w.teamId, [...(byTeam.get(w.teamId) ?? []), w]);
  return [...byTeam].map(([teamId, list]) => ({
    teamId,
    text: list.map(wantText).join("; "),
    at: list.map((w) => w.at).sort()[0]!,
    stale: list.every((w) => w.stale),
  }));
}

function flat(segments: Segment[]): string {
  return segments
    .map((s) => (typeof s === "string" ? s : `“${s.ref.title}”`))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** The brief as plain text, for pasting into an email or chat. */
export function briefAsText(
  brief: PortfolioBrief,
  narrative: BriefNarrative | undefined,
  teamName: (id: string) => string,
): string {
  const t = brief.totals;
  const date = new Date(brief.generatedAt).toLocaleDateString(undefined, { dateStyle: "long" });
  const scope = brief.orgUnit ?? "Whole organisation";
  const lines: string[] = [`Portfolio brief: ${scope}, ${periodPhrase(brief.days)} (${date})`, ""];

  if (narrative) {
    lines.push(narrative.headline);
    for (const p of narrative.points) lines.push(`- ${p.text}`);
  } else {
    for (const s of brief.summary) lines.push(s);
  }
  lines.push("");

  if (brief.decisions.length) {
    lines.push("Decisions for you");
    brief.decisions.forEach((d, n) =>
      lines.push(
        `${n + 1}. ${DECISION_LABEL[d.kind]}: ${flat(decisionSentence(d, brief, teamName))}`,
      ),
    );
    lines.push("");
  }

  const wanted = brief.wanted.filter((w) => w.teams > 0);
  if (wanted.length) {
    lines.push("Most wanted");
    for (const w of wanted.slice(0, 5)) {
      const by = wantsByTeam(w.wants)
        .filter((x) => !x.stale)
        .map((x) => `${teamName(x.teamId)} ${x.text}`);
      lines.push(
        `- ${w.initiative.title} (${teamName(w.initiative.teamId)}, ${status(w.initiative)}): ${w.teams} ${plural(w.teams, "team")}. ${by.join("; ")}`,
      );
    }
    lines.push("");
  }

  const separate = brief.emerging.filter((e) => e.separate);
  if (separate.length) {
    lines.push("What's emerging");
    for (const e of separate)
      lines.push(
        `- ${[e.tag, ...e.related].join(" / ")}: ${e.count} ${plural(e.count, "initiative")} across ${list(e.teamIds.map(teamName))}`,
      );
    lines.push("");
  }

  if (brief.changes.length) {
    lines.push("What changed");
    for (const c of brief.changes.slice(0, 8)) lines.push(`- ${flat(changeSentence(c, teamName))}`);
    lines.push("");
  }

  lines.push(
    "The numbers",
    `- ${t.live} live initiatives across ${brief.teams.length} teams (${t.strategic} strategic)`,
    `- ${t.newInPeriod} new${t.newPreviousPeriod !== null ? ` (${t.newPreviousPeriod} in the period before)` : ""}; ${t.shippedInPeriod} shipped; ${t.byStatus.on_hold} on hold; ${t.goneQuiet} gone quiet`,
    "",
    "Generated by Scry. Cancelled and merged initiatives are not counted.",
  );
  return lines.join("\n");
}
