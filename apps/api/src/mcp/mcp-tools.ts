// The MCP server's tools: definitions (what AI assistants see) and argument
// parsing. All read-only. Pure, so both are unit-tested; the service that
// runs them is mcp-tools.service.ts.

import { ToolError, type ToolDefinition } from "./mcp-protocol";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STATUSES = [
  "idea",
  "planned",
  "in_progress",
  "on_hold",
  "shipped",
  "cancelled",
] as const;
export const BRIEF_DAYS = [30, 90, 180, 365, 0] as const;

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const SERVER_INSTRUCTIONS =
  "Scry is the organisation's shared register of initiatives: ideas, plans and work in " +
  "progress, owned by teams. Use it to find out whether someone is already working on " +
  "something, who to talk to, which teams build on each other's work, and what other " +
  "teams need. Every initiative has a `url` to open it in Scry; cite it. Only state what " +
  "the tools return; Scry is read-only here, so to add or change anything, send the " +
  "person to the url.";

export const TOOLS: ToolDefinition[] = [
  {
    name: "search_initiatives",
    title: "Search initiatives",
    description:
      "Find initiatives about a topic, by meaning when Scry has an AI model connected " +
      "(plus work related to the matches), otherwise by keywords. Use for 'is anyone " +
      "working on X?' or 'who owns Y?'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in plain words.", maxLength: 500 },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "check_idea",
    title: "Check an idea for existing work",
    description:
      "Before starting something, check whether it already exists: returns up to three " +
      "initiatives that look like the same work, as strong or weak matches. Needs an AI " +
      "model connected to Scry.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "The idea in a sentence or two.",
          minLength: 12,
          maxLength: 4000,
        },
      },
      required: ["description"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "get_initiative",
    title: "Get an initiative",
    description:
      "One initiative in full: summary, status, team, contact person, dates, tags, its " +
      "relationships with other teams' work, which other teams need it, and possible " +
      "duplicates.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The initiative's id.", format: "uuid" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "list_initiatives",
    title: "List initiatives",
    description:
      "Initiatives filtered by team, status, tag or words in the title or summary, newest " +
      "first. Pass `cursor` from the previous answer for the next page.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", description: "A team's name or id (see list_teams)." },
        status: { type: "string", enum: [...STATUSES] },
        tag: { type: "string" },
        text: { type: "string", description: "Words in the title, summary or tags." },
        sort: { type: "string", enum: ["updated", "title", "target"], default: "updated" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        cursor: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "list_teams",
    title: "List teams",
    description: "Every team, with its org unit, country and how many initiatives it has.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "portfolio_brief",
    title: "Portfolio brief",
    description:
      "The leadership brief: totals, decisions that need someone, what's wanted most, " +
      "emerging themes, what changed, and likely duplicates. Every figure is computed by " +
      "Scry; report them as given.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          enum: [...BRIEF_DAYS],
          default: 90,
          description: "Period to look back over; 0 for all time.",
        },
        orgUnit: { type: "string", description: "Only this org unit." },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
  },
];

// ------------------------------------------------------------- arguments

function str(
  args: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; min?: number; max: number },
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (opts.required) throw new ToolError(`\`${key}\` is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new ToolError(`\`${key}\` must be text`);
  const text = value.trim();
  if (opts.required && !text) throw new ToolError(`\`${key}\` is required`);
  if (opts.min && text.length < opts.min) {
    throw new ToolError(`\`${key}\` needs at least ${opts.min} characters`);
  }
  if (text.length > opts.max) throw new ToolError(`\`${key}\` is at most ${opts.max} characters`);
  return text || undefined;
}

function int(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ToolError(`\`${key}\` must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function oneOf<T extends string | number>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  const found = allowed.find((a) => a === value || String(a) === String(value));
  if (found === undefined) {
    throw new ToolError(`\`${key}\` must be one of: ${allowed.join(", ")}`);
  }
  return found;
}

export const parse = {
  search_initiatives: (a: Record<string, unknown>) => ({
    query: str(a, "query", { required: true, max: 500 })!,
    limit: int(a, "limit", 10, 1, 25),
  }),
  check_idea: (a: Record<string, unknown>) => ({
    description: str(a, "description", { required: true, min: 12, max: 4000 })!,
  }),
  get_initiative: (a: Record<string, unknown>) => {
    const id = str(a, "id", { required: true, max: 36 })!;
    if (!UUID.test(id)) throw new ToolError("`id` must be an initiative id (a UUID)");
    return { id };
  },
  list_initiatives: (a: Record<string, unknown>) => ({
    team: str(a, "team", { max: 200 }),
    status: oneOf(a, "status", STATUSES),
    tag: str(a, "tag", { max: 100 }),
    text: str(a, "text", { max: 200 }),
    sort: oneOf(a, "sort", ["updated", "title", "target"] as const) ?? "updated",
    limit: int(a, "limit", 20, 1, 50),
    cursor: str(a, "cursor", { max: 1000 }),
  }),
  list_teams: () => ({}),
  portfolio_brief: (a: Record<string, unknown>) => ({
    days: oneOf(a, "days", BRIEF_DAYS) ?? 90,
    orgUnit: str(a, "orgUnit", { max: 200 }),
  }),
};

export type ToolName = keyof typeof parse;

/** A team named by the caller: its id, or its name in any case. */
export function findTeam<T extends { id: string; name: string }>(teams: T[], wanted: string): T {
  const needle = wanted.trim().toLowerCase();
  const exact = teams.find((t) => t.id === wanted.trim() || t.name.toLowerCase() === needle);
  if (exact) return exact;
  const partial = teams.filter((t) => t.name.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0]!;
  const names = (partial.length ? partial : teams).map((t) => t.name).slice(0, 20);
  throw new ToolError(
    `${partial.length ? "Several teams match" : "No team is called"} "${wanted}". Teams: ${names.join(", ")}`,
  );
}
