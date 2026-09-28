import type { InitiativeStatus, InitiativeTier, Team } from "@scry/shared";
import type { InitiativeInput } from "./api";

/** RFC 4180 CSV: quoted fields, doubled quotes, commas/newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, ""); // Excel's BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export type ImportPreset = "scry" | "jira";

export interface MappedRow {
  line: number;
  input: InitiativeInput | null;
  /** Why this row can't be imported (input is null), or a non-fatal note. */
  error?: string;
  warning?: string;
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

/** Jira's default workflow names + common variants → Scry statuses. */
const JIRA_STATUS: Record<string, InitiativeStatus> = {
  "to do": "planned",
  todo: "planned",
  backlog: "idea",
  open: "idea",
  "selected for development": "planned",
  "in progress": "in_progress",
  "in review": "in_progress",
  "in development": "in_progress",
  blocked: "on_hold",
  "on hold": "on_hold",
  done: "shipped",
  closed: "shipped",
  resolved: "shipped",
  released: "shipped",
  "won't do": "cancelled",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const SCRY_STATUSES: InitiativeStatus[] = [
  "idea",
  "planned",
  "in_progress",
  "on_hold",
  "shipped",
  "cancelled",
];

/** Scry's own status names first, then common Jira workflow names. */
function toStatus(raw: string): InitiativeStatus | undefined {
  const n = norm(raw);
  if (!n) return undefined;
  return SCRY_STATUSES.find((s) => norm(s) === n) ?? JIRA_STATUS[n];
}

/**
 * Accepts YYYY-MM-DD, ISO timestamps, and Jira's "12/Mar/25 4:32 PM" /
 * "12/Mar/2025" shapes. Returns YYYY-MM-DD or undefined.
 */
export function toIsoDate(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const jira = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})/);
  if (jira) {
    const month = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(jira[2]!.toLowerCase()) / 3 + 1;
    if (month < 1) return undefined;
    const year = jira[3]!.length === 2 ? 2000 + Number(jira[3]) : Number(jira[3]);
    return `${year}-${String(month).padStart(2, "0")}-${jira[1]!.padStart(2, "0")}`;
  }
  return undefined;
}

/** Header aliases per field; first match wins. Jira exports repeat "Labels" per label. */
const COLUMNS = {
  title: ["title", "summary", "name"],
  summary: ["summary", "description", "details"],
  status: ["status"],
  tier: ["tier"],
  team: ["team", "team name", "component/s", "components"],
  start: ["start date", "start", "start_date"],
  target: ["target date", "target", "due date", "due", "target_date"],
  tags: ["tags", "labels", "label"],
  link: ["link", "external link", "url", "issue url"],
  key: ["issue key", "key"],
} as const;

export function mapRows(
  rows: string[][],
  preset: ImportPreset,
  teams: Team[],
  jiraBaseUrl = "",
): MappedRow[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const heads = header.map(norm);
  const find = (aliases: readonly string[], skip?: number) =>
    heads.findIndex((h, i) => i !== skip && aliases.includes(h));

  const titleCol = find(COLUMNS.title);
  // In Jira exports "Summary" is the title, so the description comes from elsewhere.
  const summaryCol = preset === "jira" ? find(["description"]) : find(COLUMNS.summary, titleCol);
  const col = {
    status: find(COLUMNS.status),
    tier: find(COLUMNS.tier),
    team: find(COLUMNS.team),
    start: find(COLUMNS.start),
    target: find(COLUMNS.target),
    link: find(COLUMNS.link),
    key: find(COLUMNS.key),
  };
  const tagCols = heads.flatMap((h, i) =>
    (COLUMNS.tags as readonly string[]).includes(h) ? [i] : [],
  );
  const teamByName = new Map(teams.map((t) => [norm(t.name), t.id]));

  return body.map((cells, idx): MappedRow => {
    const line = idx + 2; // 1-based + header row
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");

    const title = get(titleCol);
    if (!title) return { line, input: null, error: "Missing title" };
    let summary = get(summaryCol);
    const warnings: string[] = [];
    if (!summary) {
      summary = title;
      warnings.push("no description — used the title");
    }

    const teamName = get(col.team);
    let teamId: string | undefined;
    if (teamName) {
      teamId = teamByName.get(norm(teamName));
      if (!teamId) return { line, input: null, error: `Unknown team "${teamName}"` };
    }

    const statusRaw = get(col.status);
    const status = toStatus(statusRaw);
    if (statusRaw && !status) warnings.push(`unknown status "${statusRaw}" — set to Idea`);

    const tierRaw = norm(get(col.tier));
    const tier: InitiativeTier | undefined =
      tierRaw === "strategic" || tierRaw === "tactical" ? tierRaw : undefined;

    const tags = [
      ...new Set(
        tagCols
          // Jira labels can't contain spaces, so a space separates labels there;
          // Scry tags can ("design system"), so only commas/semicolons split.
          .flatMap((i) => get(i).split(preset === "jira" ? /[,;\s]+/ : /[,;]/))
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ),
    ].slice(0, 20);

    let externalLink = get(col.link) || undefined;
    const key = get(col.key);
    if (!externalLink && key && jiraBaseUrl) {
      externalLink = `${jiraBaseUrl.replace(/\/+$/, "")}/browse/${key}`;
    }

    return {
      line,
      input: {
        title: title.slice(0, 200),
        summary: summary.slice(0, 5000),
        status: status ?? "idea",
        tier,
        teamId,
        startDate: toIsoDate(get(col.start)),
        targetDate: toIsoDate(get(col.target)),
        tags,
        externalLink,
      },
      warning: warnings.join("; ") || undefined,
    };
  });
}

export const SCRY_TEMPLATE = [
  "title,summary,status,tier,team,start date,target date,tags,link",
  '"Unified checkout SDK","One embeddable checkout for web and mobile.",planned,strategic,Payments,2026-10-01,2027-02-01,"sdk, checkout",https://jira.example.com/browse/PAY-1',
].join("\n");
