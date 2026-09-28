import type { SearchResult } from "../search/types";
import type { MatchClassification } from "./chat.constants";

/** Human-readable context for each candidate, resolved from ids before prompting. */
export interface CandidateContext {
  teamNames: Map<string, string>;
  contacts: Map<string, { name: string; email: string }>;
  titles: Map<string, string>;
}

/** A message from earlier in the conversation, as the model sees it. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Enough history to follow the thread; old turns and long ones are cut. */
export const HISTORY_TURNS = 12;
const TURN_CHARS = 1000;

export function historyMessages(history: ChatTurn[]): ChatTurn[] {
  const turns = history.slice(-HISTORY_TURNS).map((t) => {
    const text = t.content.trim();
    return {
      role: t.role,
      content: text.length > TURN_CHARS ? `${text.slice(0, TURN_CHARS)}…` : text,
    };
  });
  // Chat templates want the conversation to start with the person.
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

/** What the agent gets back from search_initiatives. */
export function searchToolResult(
  classification: MatchClassification,
  results: SearchResult[],
  context: CandidateContext,
) {
  return {
    classification,
    initiatives: results.map((r) => {
      const contact = context.contacts.get(r.initiative.contactPerson);
      const through = r.provenance.via === "graph" ? r.provenance.throughInitiativeId : undefined;
      return {
        id: r.initiative.id,
        title: r.initiative.title,
        summary: r.initiative.summary,
        status: r.initiative.status.replace(/_/g, " "),
        team: context.teamNames.get(r.initiative.teamId) ?? "unknown team",
        contact: contact ? `${contact.name} <${contact.email}>` : "unknown",
        foundVia:
          r.provenance.via === "semantic"
            ? `similar meaning, score ${r.provenance.score.toFixed(2)}`
            : `a relationship, ${r.provenance.hops} step(s) from "${context.titles.get(through!) ?? "another initiative"}"`,
      };
    }),
  };
}

/** What the agent should know about this conversation beyond its messages. */
export interface ConversationState {
  /** The idea from this chat, once it's been registered. */
  registeredTitle: string | null;
  /** The last thing searched for in this chat, if anything. */
  lastSearch: string | null;
  /** Initiatives earlier replies mentioned, so the agent can look them up. */
  mentioned: { id: string; title: string }[];
}

export function conversationContext(state: ConversationState): string {
  const lines = [
    state.registeredTitle
      ? `This conversation's idea is already registered as "${state.registeredTitle}". Don't offer to register it again; for a different idea, suggest starting a new chat.`
      : "This conversation's idea hasn't been registered yet.",
    state.lastSearch
      ? `You last searched for: "${state.lastSearch}".`
      : "You haven't searched for anything yet.",
  ];
  if (state.mentioned.length) {
    lines.push(
      "Initiatives you mentioned earlier (use get_initiative for details):",
      ...state.mentioned.map((m) => `- ${m.title} (id: ${m.id})`),
    );
  }
  return lines.join("\n");
}

/**
 * The initiatives an answer cites: those a tool returned that the answer
 * names by title. Anything else it says about initiatives cites nothing,
 * so an invented initiative can't show up as evidence.
 */
export function citedInitiatives<T extends { id: string; title: string }>(
  text: string,
  found: T[],
): T[] {
  const haystack = text.toLowerCase().replace(/\s+/g, " ");
  const seen = new Set<string>();
  return found.filter((f) => {
    if (seen.has(f.id)) return false;
    const title = f.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (!title || !haystack.includes(title)) return false;
    seen.add(f.id);
    return true;
  });
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID_MENTION = new RegExp(
  `\\s*[([]\\s*(?:id\\s*[:=]?\\s*)?${UUID}\\s*[)\\]]|(?:[,;]?\\s*\\bid\\s*[:=]?\\s*)?${UUID}`,
  "gi",
);

/**
 * Models sometimes echo the ids they were given, which mean nothing to a
 * reader. Citations are worked out separately (citedInitiatives).
 */
export function stripIds(text: string): string {
  return text
    .replace(ID_MENTION, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:])/g, "$1");
}

/**
 * The part of a streaming answer that's safe to show: whole words only, and
 * nothing from an unclosed bracket on, since an id may still be arriving.
 */
export function settledText(partial: string): string {
  let text = partial.slice(0, Math.max(0, partial.search(/\S*$/)));
  const open = Math.max(text.lastIndexOf("("), text.lastIndexOf("["));
  if (open > Math.max(text.lastIndexOf(")"), text.lastIndexOf("]"))) text = text.slice(0, open);
  return stripIds(text);
}
