import { describe, expect, it } from "vitest";
import { DEFAULT_COUNTRIES, assertTeamOptions, teamOptions } from "./team-options";

describe("teamOptions", () => {
  it("reads comma-separated lists, trimmed and without repeats", () => {
    expect(teamOptions({ ORG_UNITS: " Sales, Ops ,Sales,", COUNTRIES: "SE" })).toEqual({
      orgUnits: ["Sales", "Ops"],
      countries: ["SE"],
    });
  });

  it("falls back to the defaults when unset or empty", () => {
    expect(teamOptions({ COUNTRIES: " , " }).countries).toEqual(DEFAULT_COUNTRIES);
  });
});

describe("assertTeamOptions", () => {
  const options = { orgUnits: ["Engineering"], countries: ["DE"] };
  it("accepts configured values, and blanks when not required", () => {
    expect(() =>
      assertTeamOptions({ orgUnit: "Engineering", country: "DE" }, { required: true }, options),
    ).not.toThrow();
    expect(() => assertTeamOptions({}, { required: false }, options)).not.toThrow();
  });

  it("refuses anything else, and blanks when required", () => {
    expect(() => assertTeamOptions({ orgUnit: "Sales" }, { required: false }, options)).toThrow(
      "“Sales” isn't one of this organisation's org units: Engineering",
    );
    expect(() =>
      assertTeamOptions({ orgUnit: "Engineering" }, { required: true }, options),
    ).toThrow("Choose the team's country");
  });
});
