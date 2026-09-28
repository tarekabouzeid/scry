import type { BriefInitiativeRef, InitiativeStatus } from "@scry/shared";

/**
 * What the brief asks the database, one method per section. Each returns
 * only the rows (or grouped counts) that section shows, so the brief costs
 * the same at a thousand initiatives as at a million. `SqlBriefSource` is
 * the real one; the unit tests run the same assembly over plain arrays.
 */

/** The window and scope every section shares. */
export interface BriefQuery {
  /** Active teams in scope (the org unit's, or all of them). */
  scope: string[];
  /** Start of the period; null for all time. */
  since: Date | null;
  /** Start of the period before it, for comparison; null for all time. */
  previousSince: Date | null;
  /** Planned or in-progress work not updated since then has gone quiet. */
  quietBefore: Date;
  /** "We need this too" not confirmed since then no longer counts. */
  staleDemandBefore: Date;
}

export interface BriefTeam {
  id: string;
  name: string;
  orgUnit: string | null;
}

/** Live initiatives in scope, grouped by team and status. */
export interface BriefCountRow {
  teamId: string;
  status: InitiativeStatus;
  n: number;
  strategic: number;
  newInPeriod: number;
  newPreviousPeriod: number;
  shippedInPeriod: number;
  goneQuiet: number;
  lastUpdated: Date | null;
}

export interface Dated {
  initiative: BriefInitiativeRef;
  at: Date;
}

export interface BriefOverlapRow {
  id: string;
  score: number;
  detectedAt: Date;
  a: BriefInitiativeRef;
  aCreatedAt: Date;
  b: BriefInitiativeRef;
  bCreatedAt: Date;
}

export interface BriefOpenOverlaps {
  total: number;
  perTeam: { teamId: string; n: number }[];
  /** Highest similarity first. */
  top: BriefOverlapRow[];
}

/** An initiative other teams want, with its fresh wanting teams (most recent first). */
export interface BriefDemandRow {
  initiative: BriefInitiativeRef;
  teams: number;
  freshTeamIds: string[];
  uncommitted: boolean;
  /** Among the "most wanted" shown. */
  inWanted: boolean;
  /** Among the uncommitted demand considered for decisions. */
  inDecisions: boolean;
}

export interface BriefDemand {
  /** Most wanted first. */
  rows: BriefDemandRow[];
  /** Distinct teams wanting each team's (unshipped) work. */
  perTeam: { teamId: string; n: number }[];
}

export interface BriefWantRow {
  initiativeId: string;
  teamId: string;
  how: "asked" | "builds_on";
  reason: string | null;
  via?: BriefInitiativeRef;
  at: Date;
  stale: boolean;
}

/** On hold or gone quiet while other teams build on it. */
export interface BriefRiskRow {
  initiative: BriefInitiativeRef;
  updatedAt: Date;
  /** Teams whose open work builds on it, in the order they started to. */
  teamIds: string[];
}

export interface BriefThemeRow {
  tag: string;
  count: number;
  teamIds: string[];
  /** Equal for tags carried by exactly the same initiatives. */
  key: string;
}

export interface BriefThemeInitiative {
  tag: string;
  initiative: BriefInitiativeRef;
  createdAt: Date;
}

export interface BriefResolvedOverlapRow {
  status: "merged" | "linked" | "dismissed";
  at: Date;
  a: BriefInitiativeRef;
  aMerged: boolean;
  b: BriefInitiativeRef;
  bMerged: boolean;
}

export interface BriefMoveRow {
  initiative: BriefInitiativeRef;
  from: InitiativeStatus;
  to: InitiativeStatus;
  at: Date;
}

export interface BriefNewlyWantedRow {
  initiative: BriefInitiativeRef;
  teamId: string;
  at: Date;
}

export interface BriefSource {
  activeTeams(): Promise<BriefTeam[]>;
  counts(q: BriefQuery): Promise<BriefCountRow[]>;
  /** Gone quiet, longest first. */
  goneQuiet(q: BriefQuery, limit: number): Promise<Dated[]>;
  /** Created in the period, newest first. */
  newest(q: BriefQuery, limit: number): Promise<Dated[]>;
  openOverlaps(q: BriefQuery, limit: number): Promise<BriefOpenOverlaps>;
  demand(q: BriefQuery, limits: { wanted: number; decisions: number }): Promise<BriefDemand>;
  /** Every want (fresh or stale) for these initiatives. */
  wantsFor(q: BriefQuery, initiativeIds: string[]): Promise<BriefWantRow[]>;
  /** Most teams building on it first, then longest untouched. */
  atRisk(q: BriefQuery, limit: number): Promise<BriefRiskRow[]>;
  /** Strategic, gone quiet and nobody builds on it; longest untouched first. */
  quietStrategic(q: BriefQuery, limit: number): Promise<Dated[]>;
  /** Tags on at least two open initiatives new in the period; most teams, then most initiatives first. */
  themes(q: BriefQuery, limit: number): Promise<BriefThemeRow[]>;
  /** The newest initiatives for each of these tags. */
  themeInitiatives(q: BriefQuery, tags: string[], perTag: number): Promise<BriefThemeInitiative[]>;
  /** Duplicates settled in the period, latest first. Needs `since`. */
  resolvedOverlaps(q: BriefQuery, limit: number): Promise<BriefResolvedOverlapRow[]>;
  /** Initiatives whose last move in the period shipped them or moved them forward. Needs `since`. */
  moves(q: BriefQuery, limit: number): Promise<BriefMoveRow[]>;
  /** Teams that started wanting something in the period, dated by the first sign. Needs `since`. */
  newlyWanted(q: BriefQuery, limit: number): Promise<BriefNewlyWantedRow[]>;
}
