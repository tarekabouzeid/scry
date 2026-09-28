import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@scry/db";
import type { InitiativeAssist } from "@scry/shared";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";
import { LlmService } from "../llm/llm.service";
import { normalizeTags } from "../common/tags";
import type { AssistInitiativeDto } from "./dto/assist.dto";

const assistSchema = z.object({
  title: z
    .string()
    .describe("Short, specific initiative title, at most ~80 characters, no trailing period."),
  summary: z.string().describe("2–4 sentences: what it is, who it's for, why it matters."),
  tags: z.array(z.string()).describe("Up to 5 short lowercase topic tags; prefer existing ones."),
  tier: z.enum(["strategic", "tactical"]),
  coverage: z
    .object({ what: z.boolean(), who: z.boolean(), why: z.boolean() })
    .describe(
      "Does the summary say what it is (what), who it's for (who), and why it matters (why)?",
    ),
});

const RULES = `Rules:
- Use only facts the author gave. Never invent metrics, dates, teams, names, scope or outcomes.
- Title: specific and plain, at most 80 characters, no trailing period, no marketing words.
- Summary: 2–4 sentences covering what it is, who it's for and why it matters — as far as the author said. Don't pad a missing part with guesses; mark it false in coverage instead.
- Tags: at most 5, lowercase, hyphenated words. Reuse a tag from the existing list whenever one fits, so teams' subscriptions and filters keep working.
- Tier: "strategic" only for multi-quarter, cross-team or company-level bets; otherwise "tactical".
- Plain business English. No filler, no hype, no emojis.`;

const DRAFT_SYSTEM = `You turn an author's rough description of an idea into a draft initiative for an organisation's shared idea bank, where other teams will search for it and judge whether it overlaps their work.\n\n${RULES}`;

const IMPROVE_SYSTEM = `You edit an initiative an author has written for an organisation's shared idea bank, so other teams can find it and understand it quickly. Keep the author's meaning and wording where it already works; change only what makes it clearer or more specific. If a field is already good, return it unchanged.\n\n${RULES}`;

/** AI help inside the New initiative dialog. Suggestions only — the author decides. */
@Injectable()
export class AssistService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmService,
  ) {}

  /** The organisation's most-used tags, so suggestions reuse its vocabulary. */
  private async vocabulary(): Promise<string[]> {
    const rows = await this.db.execute<{ tag: string }>(
      sql`select tag from (select unnest(tags) as tag from initiatives where merged_into_id is null) t group by tag order by count(*) desc, tag limit 80`,
    );
    return rows.map((r) => r.tag);
  }

  async assist(user: AuthenticatedUser, dto: AssistInitiativeDto): Promise<InitiativeAssist> {
    const description = dto.description?.trim() ?? "";
    const title = dto.title?.trim() ?? "";
    const summary = dto.summary?.trim() ?? "";
    if (dto.mode === "draft" && description.length < 15)
      throw new BadRequestException("Describe the idea in a sentence or two first");
    if (dto.mode === "improve" && title.length + summary.length < 15)
      throw new BadRequestException("Write a title and a short summary first");

    const vocabulary = await this.vocabulary();
    const tagsLine = `Existing tags in use: ${vocabulary.length ? vocabulary.join(", ") : "(none yet)"}`;
    // One "- " line per sentence the author wrote: plain to read, and it keeps
    // the author's words clearly separate from the instructions.
    const lines = (text: string) =>
      text
        .split(/\n+|(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `- ${s}`)
        .join("\n");

    const prompt =
      dto.mode === "draft"
        ? `What the author wrote about their idea:\n${lines(description)}\n\n${tagsLine}`
        : `Current draft:\nTitle: ${title || "(none)"}\nSummary:\n${lines(summary) || "- (none)"}\nTags: ${(dto.tags ?? []).join(", ") || "(none)"}\n\n${tagsLine}`;

    const out = await this.llm.object("tasks", {
      schema: assistSchema,
      system: dto.mode === "draft" ? DRAFT_SYSTEM : IMPROVE_SYSTEM,
      prompt,
      caller: user,
    });
    return {
      title: out.title.trim().replace(/\.+$/, "").slice(0, 200),
      summary: out.summary.trim().slice(0, 5000),
      tags: normalizeTags(out.tags.map((t) => t.replace(/\s+/g, "-").replace(/^#/, ""))).slice(
        0,
        5,
      ),
      tier: out.tier,
      coverage: out.coverage,
    };
  }
}
