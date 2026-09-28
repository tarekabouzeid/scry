import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  edges,
  initiativeListColumns,
  initiatives,
  neighbourhood,
  TEAM_GRAPH_MAX,
  teamGraph,
  teamMap,
  teams,
  type Db,
  type InitiativeRow,
} from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";
import { ActivityService } from "../activity/activity.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OverlapsService } from "../overlaps/overlaps.service";
import { canRelateInitiative } from "../common/permissions";
import { JobsService } from "../jobs/jobs.service";

type EdgeType = (typeof edges.$inferInsert)["type"];

const VERB: Record<EdgeType, string> = {
  builds_on: "now builds on",
  replaces: "now replaces",
  related: "is now marked as related to",
};

/**
 * Relationships tell teams about each other's work: who builds on it, what it
 * replaces, what's related. They never express order or schedule, and they
 * only connect different teams (inside a team, people just talk).
 */
@Injectable()
export class EdgesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly overlaps: OverlapsService,
    private readonly jobs: JobsService,
  ) {}

  /** Edges touching any of the given initiatives (the graph view's and lists' links). */
  async listFor(initiativeIds: string[]) {
    if (initiativeIds.length === 0) return [];
    return this.db
      .select()
      .from(edges)
      .where(
        or(
          inArray(edges.fromInitiativeId, initiativeIds),
          inArray(edges.toInitiativeId, initiativeIds),
        ),
      );
  }

  /**
   * An initiative, or a team's related work, and what's up to `hops`
   * relationship steps away, capped (the graph view never draws the whole org).
   */
  async neighbourhood(options: {
    initiativeId?: string;
    teamId?: string;
    hops: number;
    limit: number;
  }) {
    const found = await neighbourhood(this.db, options);
    const rows = found.ids.length
      ? await this.db
          .select(initiativeListColumns)
          .from(initiatives)
          .where(inArray(initiatives.id, found.ids))
      : [];
    // Nearest first, as picked; also drops ids of initiatives deleted meanwhile.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const nodes = found.ids.flatMap((id) => byId.get(id) ?? []);
    if (options.initiativeId && !byId.has(options.initiativeId)) {
      throw new NotFoundException("Initiative not found");
    }
    return { nodes, edges: found.edges, truncated: found.truncated };
  }

  async overview() {
    return { ...(await teamMap(this.db)), teamLimit: TEAM_GRAPH_MAX };
  }

  async teamGraph(teamId: string) {
    const [team] = await this.db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
    if (!team) throw new NotFoundException("Team not found");
    return { teamId, ...(await teamGraph(this.db, teamId)) };
  }

  async listForInitiative(initiativeId: string) {
    return this.db
      .select()
      .from(edges)
      .where(or(eq(edges.fromInitiativeId, initiativeId), eq(edges.toInitiativeId, initiativeId)));
  }

  private async loadPair(fromId: string, toId: string) {
    const rows = await this.db
      .select()
      .from(initiatives)
      .where(inArray(initiatives.id, [fromId, toId]));
    const from = rows.find((r) => r.id === fromId);
    const to = rows.find((r) => r.id === toId);
    // Check up front so a bad id is a 404, not a foreign-key 500.
    if (!from || !to) throw new NotFoundException("Both initiatives must exist");
    return { from, to };
  }

  // Explicit edges are human-entered and confirmed by definition — unlike
  // agent-surfaced semantic matches, there's no separate confirm step.
  async create(
    user: AuthenticatedUser,
    dto: { fromInitiativeId: string; toInitiativeId: string; type: string },
  ) {
    if (dto.fromInitiativeId === dto.toInitiativeId) {
      throw new BadRequestException("An initiative cannot relate to itself");
    }
    const type = dto.type as EdgeType;
    const pair = await this.loadPair(dto.fromInitiativeId, dto.toInitiativeId);
    // "related" has no direction: store it one way so a pair can't have it twice.
    const { from, to } =
      type === "related" && pair.from.id > pair.to.id ? { from: pair.to, to: pair.from } : pair;
    if (!canRelateInitiative(user, from) && !canRelateInitiative(user, to)) {
      throw new ForbiddenException(
        "You can only add relationships to initiatives you or your team own",
      );
    }
    if (from.teamId === to.teamId) {
      const [team] = await this.db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, from.teamId));
      throw new BadRequestException(
        `Both belong to ${team?.name ?? "the same team"}. Relationships connect different teams.`,
      );
    }

    // One relationship per pair, whichever way round: it says the two teams
    // should know about each other, and more than one adds nothing.
    const [existing] = await this.db
      .select({ id: edges.id })
      .from(edges)
      .where(
        or(
          and(eq(edges.fromInitiativeId, from.id), eq(edges.toInitiativeId, to.id)),
          and(eq(edges.fromInitiativeId, to.id), eq(edges.toInitiativeId, from.id)),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException("These two are already related");
    }

    const [row] = await this.db
      .insert(edges)
      .values({ fromInitiativeId: from.id, toInitiativeId: to.id, type, createdBy: user.id })
      .returning()
      .catch((err: { code?: string }) => {
        // Two people relating the same pair at once: the unique index decides.
        if (err.code === "23505") throw new ConflictException("These two are already related");
        throw err;
      });

    await this.afterChange(user, row!.id, type, from, to, "edge_added");
    await this.overlaps.markLinked(from.id, to.id, user.id);

    return row!;
  }

  /** Creator of the edge, an owner or team member of either end, or an admin. */
  async remove(user: AuthenticatedUser, id: string) {
    const [row] = await this.db.select().from(edges).where(eq(edges.id, id)).limit(1);
    if (!row) throw new NotFoundException("Relationship not found");
    const { from, to } = await this.loadPair(row.fromInitiativeId, row.toInitiativeId);

    const allowed =
      row.createdBy === user.id || canRelateInitiative(user, from) || canRelateInitiative(user, to);
    if (!allowed) {
      throw new ForbiddenException(
        "Only the relationship's creator, the owners or teams of either initiative, or an admin can remove it",
      );
    }

    await this.db.delete(edges).where(eq(edges.id, id));
    await this.afterChange(user, row.id, row.type, from, to, "edge_removed");
  }

  private async afterChange(
    user: AuthenticatedUser,
    edgeId: string,
    type: EdgeType,
    from: InitiativeRow,
    to: InitiativeRow,
    kind: "edge_added" | "edge_removed",
  ) {
    const data = { edgeId, type };
    // Both ends' TL;DRs mention which other teams' work they connect to.
    this.jobs.enqueueTldr(from.id, to.id);
    await this.activity.log(from.id, user.id, kind, {
      ...data,
      direction: "outgoing",
      otherInitiativeId: to.id,
      otherTitle: to.title,
    });
    await this.activity.log(to.id, user.id, kind, {
      ...data,
      direction: "incoming",
      otherInitiativeId: from.id,
      otherTitle: from.title,
    });

    // Another team building on or relating to your work is exactly the
    // cross-team news Scry exists to surface — tell the target's owners.
    if (kind === "edge_added") {
      await this.notifications.notify({
        kind: "dependency_added",
        initiative: to,
        actor: user,
        includeOwners: true,
        text: `"${from.title}" ${VERB[type]} your "${to.title}"`,
        data: { ...data, otherInitiativeId: from.id },
      });
    }
  }
}
