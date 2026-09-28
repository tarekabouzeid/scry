import { BadRequestException } from "@nestjs/common";
import type { TeamOptions } from "@scry/shared";

// Used when ORG_UNITS / COUNTRIES aren't set; they match the demo's teams.
export const DEFAULT_ORG_UNITS = ["Engineering", "Marketing", "Operations", "Product", "Security"];
export const DEFAULT_COUNTRIES = ["DE", "FR", "NL", "UK", "US"];

const parse = (raw: string | undefined, fallback: string[]) => {
  const list = [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  return list.length ? list : fallback;
};

/**
 * The org units and countries a team can be filed under. Configured per
 * deployment (comma-separated ORG_UNITS and COUNTRIES), so reports group
 * cleanly instead of by whatever people type.
 */
export function teamOptions(env: NodeJS.ProcessEnv = process.env): TeamOptions {
  return {
    orgUnits: parse(env.ORG_UNITS, DEFAULT_ORG_UNITS),
    countries: parse(env.COUNTRIES, DEFAULT_COUNTRIES),
  };
}

/** Refuse an org unit or country that isn't one of the configured ones. */
export function assertTeamOptions(
  dto: { orgUnit?: string | null; country?: string | null },
  { required }: { required: boolean },
  options: TeamOptions = teamOptions(),
) {
  for (const [value, allowed, label] of [
    [dto.orgUnit, options.orgUnits, "org unit"],
    [dto.country, options.countries, "country"],
  ] as const) {
    if (value === undefined || value === null || value === "") {
      if (required) throw new BadRequestException(`Choose the team's ${label}`);
      continue;
    }
    if (!allowed.includes(value)) {
      throw new BadRequestException(
        `“${value}” isn't one of this organisation's ${label === "org unit" ? "org units" : "countries"}: ${allowed.join(", ")}`,
      );
    }
  }
}
