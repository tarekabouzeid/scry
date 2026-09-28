import type { PublicInitiativeRow } from "@scry/db";

export type MatchProvenance =
  { via: "semantic"; score: number } | { via: "graph"; hops: number; throughInitiativeId: string };

export interface SearchResult {
  initiative: PublicInitiativeRow;
  provenance: MatchProvenance;
}
