import { BadRequestException } from "@nestjs/common";
import { MAX_HOPS, NEIGHBOURHOOD_MAX } from "@scry/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_EDGE_LOOKUP_IDS = 200;

/** `?initiativeIds=a,b,…` → ids; required, since nothing should need every edge. */
export function parseInitiativeIds(raw: string | undefined): string[] {
  const ids = [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) throw new BadRequestException("initiativeIds is required");
  if (ids.length > MAX_EDGE_LOOKUP_IDS) {
    throw new BadRequestException(`At most ${MAX_EDGE_LOOKUP_IDS} initiativeIds at a time`);
  }
  if (!ids.every((id) => UUID.test(id))) {
    throw new BadRequestException("initiativeIds must be initiative ids");
  }
  return ids;
}

export interface NeighbourhoodQuery {
  initiativeId?: string;
  teamId?: string;
  hops: number;
  limit: number;
}

/** Exactly one of initiativeId or teamId; hops 1–2 (default 1); limit ≤ 300. */
export function parseNeighbourhoodQuery(q: {
  initiativeId?: string;
  teamId?: string;
  hops?: string;
  limit?: string;
}): NeighbourhoodQuery {
  const initiativeId = q.initiativeId?.trim() || undefined;
  const teamId = q.teamId?.trim() || undefined;
  if (!initiativeId === !teamId) {
    throw new BadRequestException("Give either initiativeId or teamId");
  }
  if (![initiativeId, teamId].every((id) => id === undefined || UUID.test(id))) {
    throw new BadRequestException("initiativeId and teamId must be ids");
  }
  const int = (raw: string | undefined, fallback: number, max: number, name: string) => {
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new BadRequestException(`${name} must be a whole number from 1 to ${max}`);
    }
    return n;
  };
  return {
    initiativeId,
    teamId,
    hops: int(q.hops, 1, MAX_HOPS, "hops"),
    limit: int(q.limit, NEIGHBOURHOOD_MAX, NEIGHBOURHOOD_MAX, "limit"),
  };
}
