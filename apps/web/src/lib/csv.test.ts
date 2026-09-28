import { describe, expect, it } from "vitest";
import type { Team } from "@scry/shared";
import { mapRows, parseCsv, toIsoDate } from "./csv";

const team = (id: string, name: string): Team => ({
  id,
  name,
  orgUnit: null,
  country: null,
  status: "active",
  createdBy: null,
  createdAt: "",
  updatedAt: "",
});
const teams = [team("t-pay", "Payments"), team("t-growth", "Growth")];

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas/newlines, CRLF and BOM", () => {
    const text = '\uFEFFa,b,c\r\n"x, y","say ""hi""","multi\nline"\r\n1,2,3\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "multi\nline"],
      ["1", "2", "3"],
    ]);
  });

  it("drops blank lines and keeps empty fields", () => {
    expect(parseCsv("a,,c\n\n,,\nd,e,")).toEqual([
      ["a", "", "c"],
      ["d", "e", ""],
    ]);
  });
});

describe("toIsoDate", () => {
  it.each([
    ["2026-03-12", "2026-03-12"],
    ["2026-03-12T10:00:00Z", "2026-03-12"],
    ["12/Mar/25 4:32 PM", "2025-03-12"],
    ["5/Dec/2026", "2026-12-05"],
    ["not a date", undefined],
    ["", undefined],
  ])("%s -> %s", (input, expected) => {
    expect(toIsoDate(input)).toBe(expected);
  });
});

describe("mapRows", () => {
  it("maps a Scry-format CSV, resolving team names case-insensitively", () => {
    const rows = parseCsv(
      "title,summary,status,tier,team,start date,target date,tags,link\n" +
        '"Checkout SDK","One checkout",In Progress,Strategic,payments,2026-10-01,2027-02-01,"SDK, design system",https://x.test/1',
    );
    const [row] = mapRows(rows, "scry", teams);
    expect(row!.error).toBeUndefined();
    expect(row!.input).toEqual({
      title: "Checkout SDK",
      summary: "One checkout",
      status: "in_progress",
      tier: "strategic",
      teamId: "t-pay",
      startDate: "2026-10-01",
      targetDate: "2027-02-01",
      tags: ["sdk", "design system"],
      externalLink: "https://x.test/1",
    });
  });

  it("maps a Jira export: Summary is the title, repeated Labels columns, Jira statuses and dates", () => {
    const rows = parseCsv(
      "Issue key,Summary,Description,Status,Labels,Labels,Due date\n" +
        "PAY-7,Refund automation,Auto-approve small refunds,Done,ops payments,,12/Mar/26 4:32 PM\n" +
        "PAY-8,No description,,Selected for Development,,,\n",
    );
    const [a, b] = mapRows(rows, "jira", teams, "https://jira.example.com/");
    expect(a!.input).toMatchObject({
      title: "Refund automation",
      summary: "Auto-approve small refunds",
      status: "shipped",
      tags: ["ops", "payments"],
      targetDate: "2026-03-12",
      externalLink: "https://jira.example.com/browse/PAY-7",
    });
    expect(b!.input).toMatchObject({ summary: "No description", status: "planned" });
    expect(b!.warning).toMatch(/no description/);
  });

  it("rejects rows with no title or an unknown team, and flags unknown statuses", () => {
    const rows = parseCsv("title,summary,team,status\n,x,,\nA,b,Nope,\nC,d,,weird");
    const [noTitle, badTeam, oddStatus] = mapRows(rows, "scry", teams);
    expect(noTitle).toMatchObject({ input: null, error: "Missing title", line: 2 });
    expect(badTeam).toMatchObject({ input: null, error: 'Unknown team "Nope"' });
    expect(oddStatus!.input!.status).toBe("idea");
    expect(oddStatus!.warning).toMatch(/unknown status/);
  });
});
