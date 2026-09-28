import { describe, expect, it } from "vitest";
import type { SearchResult } from "../search/types";
import {
  citedInitiatives,
  conversationContext,
  historyMessages,
  HISTORY_TURNS,
  searchToolResult,
  settledText,
  stripIds,
  type CandidateContext,
  type ChatTurn,
} from "./chat.prompt";

const TEAM = "9c41e7d2-5b0a-4f3e-a8d1-2e6f0b7c9a14";
const CONTACT = "11111111-1111-4111-8111-111111111111";

function initiative(id: string, title: string) {
  return {
    id,
    title,
    summary: `${title} summary`,
    status: "in_progress",
    tier: "strategic",
    teamId: TEAM,
    submittedBy: CONTACT,
    contactPerson: CONTACT,
    startDate: null,
    targetDate: null,
    tags: [],
    externalLink: null,
    holdReason: null,
    mergedIntoId: null,
    mergedAt: null,
    tldr: null,
    tldrAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SearchResult["initiative"];
}

const context: CandidateContext = {
  teamNames: new Map([[TEAM, "Data & ML"]]),
  contacts: new Map([[CONTACT, { name: "Priya Shah", email: "priya@example.com" }]]),
  titles: new Map([
    ["a", "Self-serve analytics"],
    ["b", "Feature store"],
  ]),
};

describe("historyMessages", () => {
  it("keeps the latest turns, cuts long ones and starts with the person", () => {
    const history: ChatTurn[] = Array.from({ length: HISTORY_TURNS + 3 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `message ${i}`,
    }));
    history.push({ role: "user", content: "x".repeat(2000) });
    const turns = historyMessages(history);
    expect(turns.length).toBeLessThanOrEqual(HISTORY_TURNS);
    expect(turns[0]!.role).toBe("user");
    expect(turns.at(-1)!.content).toMatch(/^x{1000}…$/);
  });
});

describe("searchToolResult", () => {
  const results: SearchResult[] = [
    {
      initiative: initiative("a", "Self-serve analytics"),
      provenance: { via: "semantic", score: 0.912 },
    },
    {
      initiative: initiative("b", "Feature store"),
      provenance: { via: "graph", hops: 1, throughInitiativeId: "a" },
    },
  ];
  const result = searchToolResult("STRONG_MATCH", results, context);

  it("carries the computed classification", () => {
    expect(result.classification).toBe("STRONG_MATCH");
  });

  it("names the team and contact instead of passing their ids", () => {
    expect(result.initiatives[0]).toMatchObject({
      id: "a",
      title: "Self-serve analytics",
      status: "in progress",
      team: "Data & ML",
      contact: "Priya Shah <priya@example.com>",
      foundVia: "similar meaning, score 0.91",
    });
    expect(JSON.stringify(result)).not.toContain(TEAM);
    expect(JSON.stringify(result)).not.toContain(CONTACT);
  });

  it("explains relationship matches by the connecting initiative's title", () => {
    expect(result.initiatives[1]!.foundVia).toBe(
      'a relationship, 1 step(s) from "Self-serve analytics"',
    );
  });

  it("degrades gracefully when context is missing", () => {
    const empty = { teamNames: new Map(), contacts: new Map(), titles: new Map() };
    const r = searchToolResult("WEAK_MATCH", results, empty);
    expect(r.initiatives[0]).toMatchObject({ team: "unknown team", contact: "unknown" });
    expect(r.initiatives[1]!.foundVia).toContain('"another initiative"');
  });
});

describe("conversationContext", () => {
  it("tells the agent what happened so far", () => {
    const text = conversationContext({
      registeredTitle: null,
      lastSearch: "Churn dashboards",
      mentioned: [{ id: "a", title: "Self-serve analytics" }],
    });
    expect(text).toContain("hasn't been registered yet");
    expect(text).toContain('You last searched for: "Churn dashboards".');
    expect(text).toContain("- Self-serve analytics (id: a)");
  });

  it("says when the idea is registered, so it isn't offered again", () => {
    const text = conversationContext({
      registeredTitle: "GPU optimisation with llm-d",
      lastSearch: null,
      mentioned: [],
    });
    expect(text).toContain('already registered as "GPU optimisation with llm-d"');
    expect(text).toContain("You haven't searched for anything yet.");
  });
});

describe("citedInitiatives", () => {
  const found = [
    { id: "a", title: "Self-serve analytics" },
    { id: "b", title: "Feature store" },
    { id: "a", title: "Self-serve analytics" },
  ];

  it("cites what the answer names, once each", () => {
    expect(citedInitiatives("Talk to Priya about **Self-Serve  analytics** first.", found)).toEqual(
      [{ id: "a", title: "Self-serve analytics" }],
    );
  });

  it("cites nothing a tool didn't return", () => {
    expect(citedInitiatives("See the Payments ledger.", found)).toEqual([]);
  });
});

describe("stripIds", () => {
  const id = "74345799-a5c1-4b68-8013-127f04c0b34f";

  it("drops ids the model echoed, however they're written", () => {
    expect(stripIds(`We found “Data lake” (ID: ${id}) owned by Payments.`)).toBe(
      "We found “Data lake” owned by Payments.",
    );
    expect(stripIds(`See Data lake [${id}], then talk to Alice.`)).toBe(
      "See Data lake, then talk to Alice.",
    );
    expect(stripIds(`Data lake, id ${id}.`)).toBe("Data lake.");
    expect(stripIds("Nothing to strip (see the brief).")).toBe("Nothing to strip (see the brief).");
  });
});

describe("settledText", () => {
  it("holds back a half-written word or bracket until it's complete", () => {
    expect(settledText("We found Data lake (ID: 7434")).toBe("We found Data lake ");
    expect(settledText("We found Data la")).toBe("We found Data ");
  });

  it("only ever grows as the answer streams in", () => {
    const full =
      "We found “Data lake” (ID: 74345799-a5c1-4b68-8013-127f04c0b34f) owned by Payments. Talk to Alice.";
    let prev = "";
    for (let i = 1; i <= full.length; i++) {
      const next = settledText(full.slice(0, i));
      expect(next.startsWith(prev)).toBe(true);
      prev = next;
    }
    expect(prev).not.toContain("7434");
  });
});
