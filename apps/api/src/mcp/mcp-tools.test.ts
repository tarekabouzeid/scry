import { describe, expect, it } from "vitest";
import { ToolError } from "./mcp-protocol";
import { findTeam, parse } from "./mcp-tools";

describe("tool arguments", () => {
  it("applies defaults and limits", () => {
    expect(parse.search_initiatives({ query: " churn " })).toEqual({ query: "churn", limit: 10 });
    expect(() => parse.search_initiatives({ query: "x", limit: 500 })).toThrow(ToolError);
    expect(() => parse.search_initiatives({})).toThrow(/required/);
    expect(parse.list_initiatives({ status: "on_hold", limit: "5" })).toMatchObject({
      status: "on_hold",
      limit: 5,
      sort: "updated",
    });
    expect(() => parse.list_initiatives({ status: "done" })).toThrow(/one of/);
    expect(parse.portfolio_brief({})).toEqual({ days: 90, orgUnit: undefined });
    expect(parse.portfolio_brief({ days: 0 }).days).toBe(0);
    expect(() => parse.portfolio_brief({ days: 7 })).toThrow(ToolError);
  });

  it("wants a real id and a real description", () => {
    expect(() => parse.get_initiative({ id: "1; drop table" })).toThrow(/UUID/);
    expect(parse.get_initiative({ id: "00000000-0000-4000-8000-000000000000" }).id).toBe(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(() => parse.check_idea({ description: "short" })).toThrow(/at least 12/);
  });
});

describe("findTeam", () => {
  const teams = [
    { id: "1", name: "Growth" },
    { id: "2", name: "Data & ML" },
    { id: "3", name: "Payments Platform" },
  ];
  it("finds by id, name in any case, or a unique part of the name", () => {
    expect(findTeam(teams, "2").name).toBe("Data & ML");
    expect(findTeam(teams, "growth").id).toBe("1");
    expect(findTeam(teams, "payments").id).toBe("3");
  });
  it("names the teams when it can't tell", () => {
    expect(() => findTeam(teams, "Marketing")).toThrow(/No team is called "Marketing".*Growth/);
    expect(() => findTeam(teams, "a")).toThrow(/Several teams match/);
  });
});
