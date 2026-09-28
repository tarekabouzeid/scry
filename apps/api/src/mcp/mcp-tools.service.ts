import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { inArray } from "drizzle-orm";
import { users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";
import { InitiativesService } from "../initiatives/initiatives.service";
import { SignalsService } from "../initiatives/signals.service";
import { SearchService } from "../search/search.service";
import { LlmService } from "../llm/llm.service";
import { EdgesService } from "../edges/edges.service";
import { OverlapsService } from "../overlaps/overlaps.service";
import { TeamsService } from "../teams/teams.service";
import { ReportsService } from "../reports/reports.service";
import { ToolError, type ToolOutput } from "./mcp-protocol";
import { findTeam, parse, type ToolName } from "./mcp-tools";

type Row = Awaited<ReturnType<InitiativesService["getOrThrow"]>>;

const OUTGOING = { builds_on: "builds on", replaces: "replaces", related: "is related to" };
const INCOMING = {
  builds_on: "is built on by",
  replaces: "is replaced by",
  related: "is related to",
};

/**
 * Runs the MCP tools for one person, through the same services the web app
 * uses, so answers match what they'd see in Scry. Nothing here writes.
 */
@Injectable()
export class McpToolsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly initiatives: InitiativesService,
    private readonly signals: SignalsService,
    private readonly search: SearchService,
    private readonly llm: LlmService,
    private readonly edges: EdgesService,
    private readonly overlaps: OverlapsService,
    private readonly teams: TeamsService,
    private readonly reports: ReportsService,
  ) {}

  async call(
    user: AuthenticatedUser,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolOutput> {
    switch (name as ToolName) {
      case "search_initiatives":
        return this.searchInitiatives(user, parse.search_initiatives(args));
      case "check_idea":
        return this.checkIdea(user, parse.check_idea(args));
      case "get_initiative":
        return this.getInitiative(parse.get_initiative(args));
      case "list_initiatives":
        return this.listInitiatives(parse.list_initiatives(args));
      case "list_teams":
        return this.listTeams();
      case "portfolio_brief":
        return this.brief(parse.portfolio_brief(args));
      default:
        throw new ToolError(`Unknown tool: ${name}`);
    }
  }

  private url(id: string) {
    const web = this.config.get<string>("WEB_ORIGIN") ?? "";
    return `${web}/?i=${id}`;
  }

  private async teamNames() {
    const rows = await this.teams.list(true);
    return new Map(rows.map((t) => [t.id, t.name]));
  }

  /** What an assistant needs to talk about an initiative, and a link to it. */
  private card(row: Row, teamName: Map<string, string>) {
    return {
      id: row.id,
      title: row.title,
      summary: row.summary.length > 400 ? `${row.summary.slice(0, 399)}…` : row.summary,
      tldr: row.tldr ?? null,
      status: row.status,
      holdReason: row.holdReason ?? null,
      team: teamName.get(row.teamId) ?? null,
      tags: row.tags,
      startDate: row.startDate ?? null,
      targetDate: row.targetDate ?? null,
      updatedAt: row.updatedAt,
      mergedInto: row.mergedIntoId ?? null,
      url: this.url(row.id),
    };
  }

  private async searchInitiatives(
    user: AuthenticatedUser,
    { query, limit }: { query: string; limit: number },
  ): Promise<ToolOutput> {
    const teamName = await this.teamNames();
    if (await this.llm.isConfigured()) {
      const results = await this.search.hybridSearch(query, limit, 1, {
        id: user.id,
        email: user.email,
      });
      const kept = results.filter((r) => !r.initiative.mergedIntoId).slice(0, limit);
      return {
        data: {
          mode: "semantic",
          results: kept.map((r) => ({
            ...this.card(r.initiative as Row, teamName),
            match:
              r.provenance.via === "semantic"
                ? { via: "meaning", score: Math.round(r.provenance.score * 100) / 100 }
                : { via: "relationship", to: r.provenance.throughInitiativeId },
          })),
        },
        ids: kept.map((r) => r.initiative.id),
      };
    }
    // Everything works without AI: fall back to the list's word search.
    const page = await this.initiatives.list({ search: query, unmerged: true, limit });
    return {
      data: {
        mode: "keywords",
        note: "No AI model is connected to Scry, so this matched words, not meaning.",
        results: page.items.map((r) => this.card(r as Row, teamName)),
      },
      ids: page.items.map((r) => r.id),
    };
  }

  private async checkIdea(
    user: AuthenticatedUser,
    { description }: { description: string },
  ): Promise<ToolOutput> {
    if (!(await this.llm.isConfigured())) {
      throw new ToolError(
        "Checking an idea needs an AI model connected to Scry. Use search_initiatives with a few keywords instead.",
      );
    }
    const teamName = await this.teamNames();
    const matches = await this.search.similarTo(description, { id: user.id, email: user.email });
    return {
      data: {
        matches: matches.map((m) => ({
          ...this.card(m.initiative as Row, teamName),
          strength: m.strength,
          score: Math.round(m.score * 100) / 100,
        })),
        note: matches.length
          ? "Strong matches are probably the same work: talk to that team before starting."
          : "Nothing similar is registered yet.",
      },
      ids: matches.map((m) => m.initiative.id),
    };
  }

  private async getInitiative({ id }: { id: string }): Promise<ToolOutput> {
    let row: Row;
    try {
      row = await this.initiatives.getOrThrow(id);
    } catch (err) {
      if (err instanceof NotFoundException) throw new ToolError(`No initiative has id ${id}`);
      throw err;
    }
    const [teamName, edgeRows, signals, overlapRows] = await Promise.all([
      this.teamNames(),
      this.edges.listForInitiative(id),
      this.signals.list(id),
      this.overlaps.listOpenFor([id]),
    ]);
    const otherIds = [
      ...new Set([
        ...edgeRows.map((e) => (e.fromInitiativeId === id ? e.toInitiativeId : e.fromInitiativeId)),
        ...overlapRows.map((o) => (o.initiativeAId === id ? o.initiativeBId : o.initiativeAId)),
      ]),
    ];
    const others = otherIds.length ? await this.initiatives.lookup(otherIds.join(",")) : [];
    const other = new Map(others.map((o) => [o.id, o]));
    const people = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, [row.contactPerson, row.submittedBy]));
    const person = (userId: string) => {
      const p = people.find((u) => u.id === userId);
      return p ? { name: p.name, email: p.email } : null;
    };
    const ref = (otherId: string) => {
      const o = other.get(otherId);
      return o
        ? { id: o.id, title: o.title, team: teamName.get(o.teamId) ?? null, url: this.url(o.id) }
        : { id: otherId, title: null, team: null, url: this.url(otherId) };
    };
    return {
      data: {
        ...this.card(row, teamName),
        summary: row.summary,
        tier: row.tier,
        externalLink: row.externalLink ?? null,
        contact: person(row.contactPerson),
        submittedBy: person(row.submittedBy),
        relationships: edgeRows.map((e) => {
          const outgoing = e.fromInitiativeId === id;
          return {
            type: e.type,
            reads: `This ${outgoing ? OUTGOING[e.type] : INCOMING[e.type]} the other initiative`,
            other: ref(outgoing ? e.toInitiativeId : e.fromInitiativeId),
          };
        }),
        neededBy: signals.map((s) => ({
          team: s.team.name,
          note: s.note,
          confirmedAt: s.confirmedAt,
          // Unconfirmed for six months: shown, but no longer counted as demand.
          faded: s.stale,
        })),
        possibleDuplicates: overlapRows.map((o) => ({
          similarity: Math.round(o.score * 100) / 100,
          other: ref(o.initiativeAId === id ? o.initiativeBId : o.initiativeAId),
        })),
      },
      ids: [id, ...otherIds],
    };
  }

  private async listInitiatives(q: ReturnType<typeof parse.list_initiatives>): Promise<ToolOutput> {
    const teamRows = await this.teams.list(true);
    const teamName = new Map(teamRows.map((t) => [t.id, t.name]));
    const teamId = q.team ? findTeam(teamRows, q.team).id : undefined;
    let page;
    try {
      page = await this.initiatives.list({
        teamId,
        status: q.status,
        tag: q.tag,
        search: q.text,
        sort: q.sort,
        unmerged: true,
        limit: q.limit,
        cursor: q.cursor,
      });
    } catch (err) {
      if (q.cursor) throw new ToolError("That cursor is out of date; list again without it.");
      throw err;
    }
    return {
      data: {
        results: page.items.map((r) => this.card(r as Row, teamName)),
        nextCursor: page.nextCursor,
      },
      ids: page.items.map((r) => r.id),
    };
  }

  private async listTeams(): Promise<ToolOutput> {
    const [teamRows, counts] = await Promise.all([
      this.teams.list(),
      this.initiatives.counts({ groupBy: "team", unmerged: true }),
    ]);
    const count = new Map(counts.map((c) => [c.key, c.count]));
    return {
      data: {
        teams: teamRows.map((t) => ({
          id: t.id,
          name: t.name,
          orgUnit: t.orgUnit,
          country: t.country,
          initiatives: count.get(t.id) ?? 0,
        })),
      },
      ids: [],
    };
  }

  private async brief({ days, orgUnit }: { days: number; orgUnit?: string }): Promise<ToolOutput> {
    const brief = await this.reports.brief({
      days: days === 0 ? null : days,
      orgUnit: orgUnit ?? null,
    });
    return { data: brief as unknown as Record<string, unknown>, ids: [] };
  }
}
