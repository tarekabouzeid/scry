import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";
import {
  chatMessages,
  chatSessions,
  initiatives,
  teams,
  users,
  type ChatMessageEvidence,
  type Db,
} from "@scry/db";
import { ideaFromConversation, type ChatActivity } from "@scry/shared";
import { DB } from "../db/db.module";
import { LlmService } from "../llm/llm.service";
import { SearchService } from "../search/search.service";
import { InitiativesService } from "../initiatives/initiatives.service";
import { normalizeTags } from "../common/tags";
import { EdgesService } from "../edges/edges.service";
import type { CreateInitiativeDto } from "../initiatives/dto/create-initiative.dto";
import type { AuthenticatedUser } from "../auth/types";
import type { SearchResult } from "../search/types";
import {
  citedInitiatives,
  conversationContext,
  historyMessages,
  searchToolResult,
  settledText,
  stripIds,
  type CandidateContext,
  type ChatTurn,
} from "./chat.prompt";
import {
  AGENT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  type MatchClassification,
} from "./chat.constants";

export type ChatStreamEvent =
  | ({ type: "tool" } & ChatActivity)
  | { type: "delta"; text: string }
  | ({ type: "done" } & Awaited<ReturnType<ChatService["postMessage"]>>)
  | { type: "error"; message: string };

/** Tool rounds per message: search, look something up, offer, answer. */
const MAX_AGENT_STEPS = 5;

/** What the tools did during one turn: the saved reply is built from it. */
interface TurnRecord {
  searches: { query: string; classification: MatchClassification; results: SearchResult[] }[];
  /** Everything a tool returned, with how it was found (for evidence). */
  found: Map<string, { id: string; title: string; evidence: ChatMessageEvidence | null }>;
  offered: boolean;
}

const draftSchema = z.object({
  title: z.string().describe("Short, specific initiative title — at most ~80 characters."),
  summary: z.string().describe("2–4 sentences: what it is, who it's for, why it matters."),
  tags: z.array(z.string()).describe("Up to 5 short lowercase topic tags."),
  tier: z.enum(["strategic", "tactical"]),
});

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmService,
    private readonly search: SearchService,
    private readonly initiatives: InitiativesService,
    private readonly edges: EdgesService,
  ) {}

  async listSessions(userId: string) {
    return this.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt));
  }

  async getSession(userId: string, sessionId: string) {
    const [session] = await this.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);
    if (!session || session.userId !== userId) {
      throw new NotFoundException("Chat session not found");
    }

    const messages = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);

    return { session, messages };
  }

  async createSession(userId: string) {
    const [session] = await this.db.insert(chatSessions).values({ userId }).returning();
    return session!;
  }

  /**
   * Classification is computed here, deterministically, from the search
   * scores — not left to the model. The model's only job (in postMessage)
   * is to phrase the response and cite evidence; it never decides the
   * branch itself, which keeps behavior predictable and auditable.
   */
  private classify(
    results: SearchResult[],
    thresholds: { strongMatch: number; weakMatch: number },
  ): MatchClassification {
    const strongThreshold = thresholds.strongMatch;
    const weakThreshold = thresholds.weakMatch;

    const semanticScores = results
      .filter((r) => r.provenance.via === "semantic")
      .map((r) => (r.provenance as { via: "semantic"; score: number }).score);
    const topSemanticScore = semanticScores.length ? Math.max(...semanticScores) : 0;

    if (topSemanticScore >= strongThreshold) return "STRONG_MATCH";
    if (topSemanticScore >= weakThreshold) return "WEAK_MATCH";
    if (results.some((r) => r.provenance.via === "graph")) return "WEAK_MATCH";
    return "NO_MATCH";
  }

  /**
   * The agent is told to name each candidate's team and contact, so it has
   * to be given names — ids alone leave it guessing or printing UUIDs.
   */
  private async loadCandidateContext(results: SearchResult[]): Promise<CandidateContext> {
    const teamIds = [...new Set(results.map((r) => r.initiative.teamId))];
    const contactIds = [...new Set(results.map((r) => r.initiative.contactPerson))];
    const throughIds = [
      ...new Set(
        results.flatMap((r) =>
          r.provenance.via === "graph" ? [r.provenance.throughInitiativeId] : [],
        ),
      ),
    ];

    const [teamRows, userRows, throughRows] = await Promise.all([
      teamIds.length
        ? this.db
            .select({ id: teams.id, name: teams.name })
            .from(teams)
            .where(inArray(teams.id, teamIds))
        : [],
      contactIds.length
        ? this.db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, contactIds))
        : [],
      throughIds.length
        ? this.db
            .select({ id: initiatives.id, title: initiatives.title })
            .from(initiatives)
            .where(inArray(initiatives.id, throughIds))
        : [],
    ]);

    return {
      teamNames: new Map(teamRows.map((t) => [t.id, t.name])),
      contacts: new Map(userRows.map((u) => [u.id, { name: u.name, email: u.email }])),
      titles: new Map([
        ...results.map((r) => [r.initiative.id, r.initiative.title] as const),
        ...throughRows.map((t) => [t.id, t.title] as const),
      ]),
    };
  }

  /** The initiatives earlier replies cited, so the agent can refer back to them. */
  private async mentionedEarlier(messages: { evidence: ChatMessageEvidence[] | null }[]) {
    const ids = [
      ...new Set(messages.flatMap((m) => (m.evidence ?? []).map((e) => e.initiativeId))),
    ];
    if (!ids.length) return [];
    return this.db
      .select({ id: initiatives.id, title: initiatives.title })
      .from(initiatives)
      .where(inArray(initiatives.id, ids.slice(-20)));
  }

  /**
   * The agent's tools. Their code runs here, with the person's permissions:
   * the model only decides when to call them. Match strength is computed
   * from the scores, and registering is refused until the idea has been
   * searched (so nobody registers blind) and once it's registered.
   */
  private tools(
    user: AuthenticatedUser,
    session: { registeredInitiativeId: string | null },
    searchedBefore: boolean,
    turn: TurnRecord,
    onActivity: (activity: ChatActivity) => void,
  ) {
    return {
      search_initiatives: tool({
        description:
          "Search every team's initiatives for work similar to an idea, by meaning and one relationship step out.",
        inputSchema: z.object({
          query: z
            .string()
            .min(2)
            .max(500)
            .describe(
              "The idea as it stands, in one or two sentences, in the person's own terms. Keep names of projects, products and tools exactly as they wrote them.",
            ),
        }),
        execute: async ({ query }) => {
          onActivity({ tool: "search_initiatives", query });
          const results = (await this.search.hybridSearch(query, 5, 1, user)).filter(
            (r) => r.initiative.id !== session.registeredInitiativeId,
          );
          const classification = this.classify(results, await this.llm.thresholds());
          turn.searches.push({ query, classification, results });
          for (const r of results) {
            turn.found.set(r.initiative.id, {
              id: r.initiative.id,
              title: r.initiative.title,
              evidence:
                r.provenance.via === "semantic"
                  ? { initiativeId: r.initiative.id, via: "semantic", score: r.provenance.score }
                  : {
                      initiativeId: r.initiative.id,
                      via: "graph",
                      hops: r.provenance.hops,
                      throughInitiativeId: r.provenance.throughInitiativeId,
                    },
            });
          }
          return searchToolResult(
            classification,
            results,
            await this.loadCandidateContext(results),
          );
        },
      }),
      get_initiative: tool({
        description: "The details of one initiative, by the id a search or earlier reply gave.",
        inputSchema: z.object({ id: z.string().describe("The initiative's id.") }),
        execute: async ({ id }) => {
          const details = await this.initiativeDetails(id);
          if (!details) return { error: "No initiative with that id." };
          onActivity({ tool: "get_initiative", title: details.title });
          if (!turn.found.has(id)) turn.found.set(id, { id, title: details.title, evidence: null });
          return details;
        },
      }),
      offer_registration: tool({
        description:
          "Show the person a Register button under your reply. Scry drafts the form from this conversation; they edit it before saving.",
        inputSchema: z.object({}),
        execute: async () => {
          if (session.registeredInitiativeId) {
            return { error: "This conversation's idea is already registered." };
          }
          if (!searchedBefore && turn.searches.length === 0) {
            return { error: "Search for the idea first, so the person sees any similar work." };
          }
          turn.offered = true;
          onActivity({ tool: "offer_registration" });
          return { shown: true };
        },
      }),
    };
  }

  /** One initiative as the agent sees it: names, not ids. */
  private async initiativeDetails(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await this.db
      .select({
        id: initiatives.id,
        title: initiatives.title,
        summary: initiatives.summary,
        status: initiatives.status,
        holdReason: initiatives.holdReason,
        targetDate: initiatives.targetDate,
        mergedIntoId: initiatives.mergedIntoId,
        team: teams.name,
        contactName: users.name,
        contactEmail: users.email,
      })
      .from(initiatives)
      .leftJoin(teams, eq(teams.id, initiatives.teamId))
      .leftJoin(users, eq(users.id, initiatives.contactPerson))
      .where(eq(initiatives.id, id))
      .limit(1);
    if (!row) return null;
    return {
      title: row.title,
      summary: row.summary,
      status: row.status.replace(/_/g, " "),
      ...(row.holdReason ? { onHoldBecause: row.holdReason } : {}),
      ...(row.targetDate ? { targetDate: row.targetDate } : {}),
      ...(row.mergedIntoId ? { note: "Merged into another initiative." } : {}),
      team: row.team ?? "unknown team",
      contact: row.contactName ? `${row.contactName} <${row.contactEmail}>` : "unknown",
    };
  }

  /**
   * One turn of the conversation: the agent reads it, calls tools as it
   * sees fit, and answers. The exchange is saved only once it has answered,
   * and atomically: a failed call must not leave an orphaned user message
   * behind (the client re-sends it on retry, which would duplicate it).
   */
  private async runTurn(
    user: AuthenticatedUser,
    sessionId: string,
    content: string,
    emit?: (event: ChatStreamEvent) => void,
  ) {
    const { session, messages } = await this.getSession(user.id, sessionId);
    const history: ChatTurn[] = messages.flatMap((m) =>
      m.role === "user" || m.role === "assistant" ? [{ role: m.role, content: m.content }] : [],
    );
    const lastSearch = [...messages].reverse().find((m) => m.searchQuery)?.searchQuery ?? null;
    const [mentioned, registered] = await Promise.all([
      this.mentionedEarlier(messages),
      session.registeredInitiativeId
        ? this.initiativeDetails(session.registeredInitiativeId)
        : null,
    ]);

    const turn: TurnRecord = { searches: [], found: new Map(), offered: false };
    let sent = "";
    let raw = "";
    const text = await this.llm.agent({
      system: `${AGENT_SYSTEM_PROMPT}\n\n${conversationContext({
        registeredTitle: registered?.title ?? null,
        lastSearch,
        mentioned,
      })}`,
      messages: [...historyMessages(history), { role: "user", content }],
      tools: this.tools(user, session, !!lastSearch, turn, (activity) =>
        emit?.({ type: "tool", ...activity }),
      ),
      maxSteps: MAX_AGENT_STEPS,
      caller: user,
      onText: (delta) => {
        raw += delta;
        const settled = settledText(raw);
        if (settled.length > sent.length && settled.startsWith(sent)) {
          emit?.({ type: "delta", text: settled.slice(sent.length) });
          sent = settled;
        }
      },
    });
    // The last word was held back while it could still be half an id.
    const answer = stripIds(text).trim();
    if (answer.startsWith(sent) && answer.length > sent.length) {
      emit?.({ type: "delta", text: answer.slice(sent.length) });
    }

    const search = turn.searches.at(-1);
    const evidence = citedInitiatives(answer, [...turn.found.values()]).flatMap((f) => {
      // Looked up, not searched: keep how an earlier reply found it.
      const earlier = messages
        .flatMap((m) => m.evidence ?? [])
        .find((e) => e.initiativeId === f.id);
      const item = f.evidence ?? (earlier ? { ...earlier, decision: undefined } : null);
      if (!item) return [];
      const { decision: _decision, ...rest } = item;
      return [rest as ChatMessageEvidence];
    });

    const assistantMessage = await this.db.transaction(async (tx) => {
      const userSentAt = new Date();
      await tx
        .insert(chatMessages)
        .values({ sessionId: session.id, role: "user", content, createdAt: userSentAt });
      const [assistant] = await tx
        .insert(chatMessages)
        .values({
          sessionId: session.id,
          role: "assistant",
          content: answer,
          evidence,
          classification: search?.classification ?? null,
          searchQuery: search?.query ?? null,
          registerReady: turn.offered,
          // Strictly after the user message so ordering by createdAt is stable.
          createdAt: new Date(userSentAt.getTime() + 1),
        })
        .returning();
      await tx
        .update(chatSessions)
        // Named after the first message that led to a search, not a greeting.
        .set({
          updatedAt: new Date(),
          title: session.title ?? (search ? content.slice(0, 60) : null),
        })
        .where(eq(chatSessions.id, session.id));
      return assistant!;
    });

    return {
      message: assistantMessage,
      classification: search?.classification ?? null,
      candidates: turn.searches.flatMap((s) => s.results.map((r) => r.initiative)),
    };
  }

  async postMessage(user: AuthenticatedUser, sessionId: string, content: string) {
    return this.runTurn(user, sessionId, content);
  }

  /**
   * The same turn, with what the agent is doing and the answer's text
   * reported as they happen. Everything that can fail before the model
   * starts (session, AI not configured) throws before the first event, so
   * it becomes a normal HTTP error.
   */
  async streamMessage(
    user: AuthenticatedUser,
    sessionId: string,
    content: string,
    emit: (event: ChatStreamEvent) => void,
  ) {
    const result = await this.runTurn(user, sessionId, content, emit);
    emit({ type: "done", ...result });
    return result;
  }

  /** LLM-drafted initiative fields from what the user said in this chat — a starting point, always editable. */
  async draftInitiative(user: AuthenticatedUser, sessionId: string) {
    const { messages } = await this.getSession(user.id, sessionId);
    const { said, understood } = ideaFromConversation(messages);
    if (said.length === 0) {
      throw new BadRequestException("Describe the idea in the chat first");
    }

    const object = await this.llm.object("tasks", {
      schema: draftSchema,
      system: DRAFT_SYSTEM_PROMPT,
      prompt:
        `What the product owner said about their idea:\n\n${said.map((s) => `- ${s}`).join("\n")}` +
        (understood ? `\n\nHow Scry summed up the idea: ${understood}` : ""),
      caller: user,
    });

    return {
      title: object.title.trim().slice(0, 200),
      summary: object.summary.trim().slice(0, 5000),
      tags: normalizeTags(object.tags).slice(0, 5),
      tier: object.tier,
    };
  }

  /** Register the idea discussed in this chat as an initiative, and remember the link. */
  async register(user: AuthenticatedUser, sessionId: string, dto: CreateInitiativeDto) {
    const { session } = await this.getSession(user.id, sessionId);
    if (session.registeredInitiativeId) {
      throw new ConflictException("This chat's idea is already registered");
    }
    const initiative = await this.initiatives.create(user, dto, {
      activityKind: "registered_from_chat",
      chatSessionId: session.id,
    });
    await this.db
      .update(chatSessions)
      .set({ registeredInitiativeId: initiative.id, updatedAt: new Date() })
      .where(eq(chatSessions.id, session.id));
    return initiative;
  }

  /**
   * Record a human verdict on a piece of evidence. "linked" also creates the
   * explicit edge from this chat's registered initiative to the evidence —
   * the moment an agent-surfaced match becomes a confirmed relationship.
   */
  async decideEvidence(
    user: AuthenticatedUser,
    sessionId: string,
    messageId: string,
    initiativeId: string,
    decision: "linked" | "dismissed" | null,
    edgeType?: "builds_on" | "replaces" | "related",
  ) {
    const { session } = await this.getSession(user.id, sessionId);
    const [message] = await this.db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.sessionId, session.id)))
      .limit(1);
    const evidence = message?.evidence ?? [];
    const item = evidence.find((e) => e.initiativeId === initiativeId);
    if (!message || !item) throw new NotFoundException("Evidence not found");

    if (decision === "linked") {
      if (!session.registeredInitiativeId) {
        throw new BadRequestException("Register this idea first, then link it to related work");
      }
      if (!edgeType) throw new BadRequestException("edgeType is required to link");
      try {
        await this.edges.create(user, {
          fromInitiativeId: session.registeredInitiativeId,
          toInitiativeId: initiativeId,
          type: edgeType,
        });
      } catch (err) {
        // Already linked (e.g. from the detail panel) — just record the verdict.
        if (!(err instanceof ConflictException)) throw err;
      }
    }

    const next = evidence.map((e) => {
      if (e.initiativeId !== initiativeId) return e;
      const { decision: _previous, ...rest } = e;
      return decision ? { ...rest, decision } : rest;
    });
    const [updated] = await this.db
      .update(chatMessages)
      .set({ evidence: next })
      .where(eq(chatMessages.id, message.id))
      .returning();
    return updated!;
  }
}
