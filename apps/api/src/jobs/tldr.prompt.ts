import { createHash } from "node:crypto";
import { z } from "zod";

/** Everything a TL;DR is written from. When none of it changes, neither does the TL;DR. */
export interface TldrInput {
  title: string;
  summary: string;
  status: string;
  tier: string;
  team: string;
  /** Why it's on hold, when it is and the owner said. */
  holdReason: string | null;
  /** Other teams' live work this builds on: "Title (Team)". */
  buildsOn: string[];
  /** Other teams' live work that builds on this: "Title (Team)". */
  builtOnBy: string[];
  /** Other teams that said they need it too. */
  askedForBy: string[];
}

export const tldrSchema = z.object({
  tldr: z.string().describe("One sentence, at most 25 words."),
});

export const TLDR_SYSTEM = `You write the TL;DR line for one initiative in an organisation's shared idea bank. People scan it in lists to decide whether it matters to them.

Rules:
- One sentence, at most 25 words.
- Say what it is and who it's for, then where it stands. Mention being on hold (and why), which other teams build on it or asked for it, or whose work it builds on, only when the facts list it.
- Use only the facts given. Never invent dates, numbers, owners, causes or outcomes.
- Don't repeat the title word for word. No filler, no hype, no emojis, no trailing period-less fragments.`;

const list = (items: string[]) => (items.length ? items.join("; ") : "none");

export function tldrPrompt(input: TldrInput): string {
  return [
    `Title: ${input.title}`,
    `Team: ${input.team}`,
    `Status: ${input.status.replace("_", " ")}${input.holdReason ? ` (${input.holdReason})` : ""}`,
    `Tier: ${input.tier}`,
    `Summary: ${input.summary.replace(/\s+/g, " ").trim()}`,
    `Builds on: ${list(input.buildsOn)}`,
    `Built on by: ${list(input.builtOnBy)}`,
    `Asked for by: ${list(input.askedForBy)}`,
  ].join("\n");
}

/** Fingerprint of the inputs, stored next to the TL;DR to skip needless rewrites. */
export function tldrSource(input: TldrInput): string {
  return createHash("sha256").update(tldrPrompt(input)).digest("hex").slice(0, 32);
}
