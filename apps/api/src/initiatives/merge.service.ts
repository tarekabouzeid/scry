import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { aliasedTable, and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import type { MergeRequest } from "@scry/shared";
import {
  edges,
  initiativeSignals,
  initiatives,
  mergeRequests,
  overlaps,
  subscriptions,
  teams,
  users,
  type Db,
} from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";
import { ActivityService } from "../activity/activity.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AuditService } from "../audit/audit.service";
import { canEditInitiative } from "../common/permissions";
import { normalizeTags } from "../common/tags";
import { InitiativesService } from "./initiatives.service";
import { JobsService } from "../jobs/jobs.service";
import { orderPair } from "../overlaps/pair";

type EdgeRow = typeof edges.$inferSelect;
type InitiativeListRow = Awaited<ReturnType<InitiativesService["getOrThrow"]>>;

/**
 * Where an edge ends up once `sourceId` is folded into `targetId`: re-pointed
 * at the target, or dropped when it would now be a self-loop, a second
 * relationship between the same pair, or inside one team (relationships
 * only connect different teams).
 */
export function repointEdges(
  edgeRows: EdgeRow[],
  sourceId: string,
  targetId: string,
  teamOf: (initiativeId: string) => string | undefined = () => undefined,
) {
  const swap = (id: string) => (id === sourceId ? targetId : id);
  const key = (from: string, to: string) => (from < to ? `${from}|${to}` : `${to}|${from}`);
  const kept = new Set(
    edgeRows
      .filter((e) => e.fromInitiativeId !== sourceId && e.toInitiativeId !== sourceId)
      .map((e) => key(e.fromInitiativeId, e.toInitiativeId)),
  );
  const moved: Array<{ edge: EdgeRow; from: string; to: string }> = [];
  const dropped: EdgeRow[] = [];
  for (const edge of edgeRows) {
    if (edge.fromInitiativeId !== sourceId && edge.toInitiativeId !== sourceId) continue;
    const from = swap(edge.fromInitiativeId);
    const to = swap(edge.toInitiativeId);
    const k = key(from, to);
    const sameTeam = teamOf(from) !== undefined && teamOf(from) === teamOf(to);
    if (from === to || kept.has(k) || sameTeam) {
      dropped.push(edge);
    } else {
      kept.add(k);
      moved.push({ edge, from, to });
    }
  }
  return { moved, dropped };
}

@Injectable()
export class MergeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly initiatives: InitiativesService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Fold a confirmed duplicate into the initiative that carries on.
   *
   * Only the duplicate's owners (or an admin) can start this: you can fold
   * your own work into another team's, never theirs into yours. Merging
   * changes the target too (it takes on the duplicate's relationships,
   * demand, tags and followers), so it happens at once only when the person
   * can also edit the target (an admin, or someone who owns both);
   * otherwise the target's owners and team admins are asked to accept it.
   */
  async merge(user: AuthenticatedUser, sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new BadRequestException("Pick a different initiative");
    const [source, target] = await Promise.all([
      this.initiatives.getOrThrow(sourceId),
      this.initiatives.getOrThrow(targetId),
    ]);
    if (!canEditInitiative(user, source)) {
      throw new ForbiddenException(
        "Only the owners of the initiative being merged (or an admin) can merge it",
      );
    }
    this.checkMergeable(source, target);
    await this.requireFlagged(sourceId, targetId);

    if (canEditInitiative(user, target)) {
      return {
        outcome: "merged" as const,
        initiative: await this.execute(user, source, target, null),
      };
    }

    const [pending] = await this.db
      .select({ id: mergeRequests.id })
      .from(mergeRequests)
      .where(and(eq(mergeRequests.sourceId, sourceId), eq(mergeRequests.status, "pending")));
    if (pending) {
      throw new ConflictException(
        "This initiative is already waiting for a merge to be accepted. Withdraw that first.",
      );
    }
    const [row] = await this.db
      .insert(mergeRequests)
      .values({ sourceId, targetId, requestedBy: user.id })
      .returning();
    const [sourceTeam, targetTeam] = await this.teamNames(source.teamId, target.teamId);
    await this.activity.log(sourceId, user.id, "merge_requested", {
      otherInitiativeId: targetId,
      otherTitle: target.title,
      otherTeam: targetTeam,
      direction: "into",
    });
    await this.activity.log(targetId, user.id, "merge_requested", {
      otherInitiativeId: sourceId,
      otherTitle: source.title,
      otherTeam: sourceTeam,
      direction: "from",
    });
    await this.notifications.notifyPeople({
      userIds: await this.deciders(target),
      kind: "merge_request",
      initiativeId: targetId,
      actor: user,
      text: `${user.name} (${sourceTeam}) asks to merge “${source.title}” into your “${target.title}”`,
      data: { requestId: row!.id, otherInitiativeId: sourceId },
    });
    const [request] = await this.requestViews(user, eq(mergeRequests.id, row!.id));
    return { outcome: "requested" as const, request: request! };
  }

  /** The target's owners (or an admin) accept: the merge happens now, as them. */
  async approve(user: AuthenticatedUser, requestId: string) {
    const request = await this.pendingOrThrow(requestId);
    const [source, target] = await Promise.all([
      this.initiatives.getOrThrow(request.sourceId),
      this.initiatives.getOrThrow(request.targetId),
    ]);
    if (!canEditInitiative(user, target)) {
      throw new ForbiddenException("Only the owners of the initiative it would merge into decide");
    }
    try {
      this.checkMergeable(source, target);
      await this.requireFlagged(source.id, target.id);
    } catch (err) {
      // Overtaken (merged elsewhere, or no longer flagged): the request is moot.
      await this.close(requestId, "withdrawn", user.id);
      throw err;
    }
    const requester = request.requestedBy
      ? (
          await this.db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(eq(users.id, request.requestedBy))
        )[0]
      : undefined;
    const merged = await this.execute(user, source, target, requester ?? null);
    await this.close(requestId, "approved", user.id);
    return merged;
  }

  /** The target's owners say no: the duplicate stays as it is. */
  async decline(user: AuthenticatedUser, requestId: string) {
    const request = await this.pendingOrThrow(requestId);
    const [source, target] = await Promise.all([
      this.initiatives.getOrThrow(request.sourceId),
      this.initiatives.getOrThrow(request.targetId),
    ]);
    if (!canEditInitiative(user, target)) {
      throw new ForbiddenException("Only the owners of the initiative it would merge into decide");
    }
    await this.close(requestId, "declined", user.id);
    const [, targetTeam] = await this.teamNames(source.teamId, target.teamId);
    await this.activity.log(source.id, user.id, "merge_declined", {
      otherInitiativeId: target.id,
      otherTitle: target.title,
      otherTeam: targetTeam,
    });
    // The requester and the duplicate's owners, subscribed or not.
    await this.notifications.notifyPeople({
      userIds: [
        ...(request.requestedBy ? [request.requestedBy] : []),
        source.submittedBy,
        source.contactPerson,
      ],
      kind: "merge_update",
      initiativeId: source.id,
      actor: user,
      text: `${user.name} (${targetTeam}) declined merging “${source.title}” into “${target.title}”`,
      data: { requestId, otherInitiativeId: target.id, status: "declined" },
    });
  }

  /** Whoever asked (or the duplicate's owners) takes the request back. */
  async withdraw(user: AuthenticatedUser, requestId: string) {
    const request = await this.pendingOrThrow(requestId);
    const [source, target] = await Promise.all([
      this.initiatives.getOrThrow(request.sourceId),
      this.initiatives.getOrThrow(request.targetId),
    ]);
    if (request.requestedBy !== user.id && !canEditInitiative(user, source)) {
      throw new ForbiddenException(
        "Only whoever asked, or the duplicate's owners, can withdraw it",
      );
    }
    await this.close(requestId, "withdrawn", user.id);
    await this.notifications.notifyPeople({
      userIds: await this.deciders(target),
      kind: "merge_update",
      initiativeId: target.id,
      actor: user,
      text: `${user.name} withdrew the request to merge “${source.title}” into “${target.title}”`,
      data: { requestId, otherInitiativeId: source.id, status: "withdrawn" },
    });
  }

  /** Open requests from or into an initiative, as the viewer sees them. */
  async listFor(user: AuthenticatedUser, initiativeId: string): Promise<MergeRequest[]> {
    return this.requestViews(
      user,
      and(
        eq(mergeRequests.status, "pending"),
        or(eq(mergeRequests.sourceId, initiativeId), eq(mergeRequests.targetId, initiativeId)),
      )!,
    );
  }

  private checkMergeable(
    source: { mergedIntoId: string | null },
    target: { mergedIntoId: string | null },
  ) {
    if (source.mergedIntoId) throw new ConflictException("This initiative was already merged");
    if (target.mergedIntoId) {
      throw new BadRequestException(
        "That initiative was itself merged — merge into the one it went to",
      );
    }
  }

  /**
   * Only a flagged duplicate can be merged: an open overlap between the two.
   * Merging is how an overlap is settled, like "Related, not the same" and
   * "Not a duplicate"; it isn't a way to fold any two initiatives together.
   */
  private async requireFlagged(sourceId: string, targetId: string) {
    const [a, b] = orderPair(sourceId, targetId);
    const [open] = await this.db
      .select({ id: overlaps.id })
      .from(overlaps)
      .where(
        and(
          eq(overlaps.initiativeAId, a),
          eq(overlaps.initiativeBId, b),
          eq(overlaps.status, "open"),
        ),
      );
    if (!open) {
      throw new BadRequestException(
        "Only a flagged duplicate can be merged, and these two aren't flagged as one",
      );
    }
  }

  private async pendingOrThrow(requestId: string) {
    const [request] = await this.db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, requestId));
    if (!request) throw new NotFoundException("Merge request not found");
    if (request.status !== "pending") {
      throw new ConflictException(`This request was already ${request.status}`);
    }
    return request;
  }

  private async close(
    requestId: string,
    status: "approved" | "declined" | "withdrawn",
    userId: string,
  ) {
    await this.db
      .update(mergeRequests)
      .set({ status, decidedBy: userId, decidedAt: new Date() })
      .where(and(eq(mergeRequests.id, requestId), eq(mergeRequests.status, "pending")));
  }

  /** Who decides on merging into an initiative: its owners and its team's admins. */
  private async deciders(target: { teamId: string; submittedBy: string; contactPerson: string }) {
    return [
      target.submittedBy,
      target.contactPerson,
      ...(await this.notifications.teamAdminIds(target.teamId)),
    ];
  }

  private async teamNames(...teamIds: string[]): Promise<string[]> {
    const rows = await this.db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, teamIds));
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    return teamIds.map((id) => byId.get(id) ?? "another team");
  }

  private async requestViews(user: AuthenticatedUser, where: SQL): Promise<MergeRequest[]> {
    const s = aliasedTable(initiatives, "source");
    const t = aliasedTable(initiatives, "target");
    const st = aliasedTable(teams, "source_team");
    const tt = aliasedTable(teams, "target_team");
    const rows = await this.db
      .select({
        id: mergeRequests.id,
        status: mergeRequests.status,
        createdAt: mergeRequests.createdAt,
        requesterId: users.id,
        requesterName: users.name,
        source: {
          id: s.id,
          title: s.title,
          teamId: s.teamId,
          submittedBy: s.submittedBy,
          contactPerson: s.contactPerson,
        },
        target: {
          id: t.id,
          title: t.title,
          teamId: t.teamId,
          submittedBy: t.submittedBy,
          contactPerson: t.contactPerson,
        },
        sourceTeam: st.name,
        targetTeam: tt.name,
      })
      .from(mergeRequests)
      .innerJoin(s, eq(s.id, mergeRequests.sourceId))
      .innerJoin(t, eq(t.id, mergeRequests.targetId))
      .innerJoin(st, eq(st.id, s.teamId))
      .innerJoin(tt, eq(tt.id, t.teamId))
      .leftJoin(users, eq(users.id, mergeRequests.requestedBy))
      .where(where)
      .orderBy(desc(mergeRequests.createdAt));
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      source: {
        id: r.source.id,
        title: r.source.title,
        teamId: r.source.teamId,
        teamName: r.sourceTeam,
      },
      target: {
        id: r.target.id,
        title: r.target.title,
        teamId: r.target.teamId,
        teamName: r.targetTeam,
      },
      requestedBy: r.requesterId ? { id: r.requesterId, name: r.requesterName! } : null,
      canDecide: canEditInitiative(user, r.target),
      canWithdraw: r.requesterId === user.id || canEditInitiative(user, r.source),
    }));
  }

  /**
   * The merge itself. The source stays readable — its comments and history
   * intact — marked "merged into" and cancelled; relationships, followers,
   * tags and demand signals move to the target, and both teams (owners,
   * followers and team admins) hear about it.
   */
  private async execute(
    user: AuthenticatedUser,
    source: InitiativeListRow,
    target: InitiativeListRow,
    requestedBy: { id: string; name: string } | null,
  ) {
    const sourceId = source.id;
    const targetId = target.id;
    const now = new Date();
    const edgeRows = await this.db
      .select()
      .from(edges)
      .where(
        or(
          inArray(edges.fromInitiativeId, [sourceId, targetId]),
          inArray(edges.toInitiativeId, [sourceId, targetId]),
        ),
      );
    const ends = [...new Set(edgeRows.flatMap((e) => [e.fromInitiativeId, e.toInitiativeId]))];
    const teamRows = ends.length
      ? await this.db
          .select({ id: initiatives.id, teamId: initiatives.teamId })
          .from(initiatives)
          .where(inArray(initiatives.id, ends))
      : [];
    const teamOf = new Map(teamRows.map((r) => [r.id, r.teamId]));
    const { moved, dropped } = repointEdges(edgeRows, sourceId, targetId, (id) => teamOf.get(id));

    await this.db.transaction(async (tx) => {
      await tx
        .update(initiatives)
        .set({ status: "cancelled", mergedIntoId: targetId, mergedAt: now, updatedAt: now })
        .where(eq(initiatives.id, sourceId));
      await tx
        .update(initiatives)
        .set({ tags: normalizeTags([...target.tags, ...source.tags]).slice(0, 20), updatedAt: now })
        .where(eq(initiatives.id, targetId));

      for (const { edge, from, to } of moved) {
        await tx
          .update(edges)
          .set({ fromInitiativeId: from, toInitiativeId: to })
          .where(eq(edges.id, edge.id));
      }
      if (dropped.length) {
        await tx.delete(edges).where(
          inArray(
            edges.id,
            dropped.map((e) => e.id),
          ),
        );
      }

      // Followers of the duplicate now follow the survivor.
      const followers = await tx
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(
          and(eq(subscriptions.targetType, "initiative"), eq(subscriptions.targetValue, sourceId)),
        );
      if (followers.length) {
        await tx
          .insert(subscriptions)
          .values(
            followers.map((f) => ({
              userId: f.userId,
              targetType: "initiative" as const,
              targetValue: targetId,
            })),
          )
          .onConflictDoNothing();
      }

      // Demand moves over too — and the source's own team now needs the target.
      const signals = await tx
        .select()
        .from(initiativeSignals)
        .where(eq(initiativeSignals.initiativeId, sourceId));
      const carried = signals
        .filter((s) => s.teamId !== target.teamId)
        .map(({ userId, teamId, note, createdAt }) => ({ userId, teamId, note, createdAt }));
      if (source.teamId !== target.teamId) {
        carried.push({
          userId: source.contactPerson,
          teamId: source.teamId,
          note: `Merged from “${source.title}”`,
          createdAt: now,
        });
      }
      if (carried.length) {
        await tx
          .insert(initiativeSignals)
          .values(carried.map((s) => ({ ...s, initiativeId: targetId })))
          .onConflictDoNothing();
      }

      // The pair's overlap is settled by this merge; the duplicate's others are moot.
      await tx
        .update(overlaps)
        .set({ status: "merged", resolvedBy: user.id, updatedAt: now })
        .where(
          or(
            and(eq(overlaps.initiativeAId, sourceId), eq(overlaps.initiativeBId, targetId)),
            and(eq(overlaps.initiativeAId, targetId), eq(overlaps.initiativeBId, sourceId)),
          ),
        );
      await tx
        .update(overlaps)
        .set({ status: "dismissed", resolvedBy: user.id, updatedAt: now })
        .where(
          and(
            eq(overlaps.status, "open"),
            or(eq(overlaps.initiativeAId, sourceId), eq(overlaps.initiativeBId, sourceId)),
          ),
        );

      // Open requests from the duplicate, or into it, can't happen any more.
      await tx
        .update(mergeRequests)
        .set({ status: "withdrawn", decidedBy: user.id, decidedAt: now })
        .where(
          and(
            eq(mergeRequests.status, "pending"),
            or(eq(mergeRequests.sourceId, sourceId), eq(mergeRequests.targetId, sourceId)),
          ),
        );
    });

    const [sourceTeam, targetTeam] = await this.teamNames(source.teamId, target.teamId);
    const [sourceAdmins, targetAdmins] = await Promise.all([
      this.notifications.teamAdminIds(source.teamId),
      this.notifications.teamAdminIds(target.teamId),
    ]);
    // "Accepted by Priya" when it was asked for, so the asker knows who.
    const accepted = requestedBy ? ` (${user.name} accepted ${requestedBy.name}'s request)` : "";

    await this.activity.log(sourceId, user.id, "merged_into", {
      otherInitiativeId: targetId,
      otherTitle: target.title,
    });
    await this.activity.log(targetId, user.id, "merged_from", {
      otherInitiativeId: sourceId,
      otherTitle: source.title,
      otherTeam: sourceTeam,
      movedRelationships: moved.length,
    });
    // Both teams hear about it: each side's owners, followers and team admins.
    await this.notifications.notify({
      kind: "merged",
      initiative: target,
      actor: user,
      includeOwners: true,
      alsoNotify: targetAdmins,
      text: `${sourceTeam}'s "${source.title}" was merged into your "${target.title}"${accepted}`,
      data: { otherInitiativeId: sourceId },
    });
    await this.notifications.notify({
      kind: "merged",
      initiative: source,
      actor: user,
      includeOwners: true,
      alsoNotify: [...sourceAdmins, ...(requestedBy ? [requestedBy.id] : [])],
      text: `"${source.title}" was merged into ${targetTeam}'s "${target.title}"${accepted}`,
      data: { otherInitiativeId: targetId },
    });
    await this.audit.record(
      user,
      "initiatives.merged",
      `${user.name} merged “${source.title}” (${sourceTeam}) into “${target.title}” (${targetTeam})`,
      {
        targetType: "initiative",
        targetId: targetId,
        data: {
          sourceId,
          targetId,
          movedRelationships: moved.length,
          droppedRelationships: dropped.length,
          requestedBy: requestedBy?.id ?? null,
        },
      },
    );

    // The survivor now carries the duplicate's relationships and demand.
    this.jobs.enqueueTldr(targetId, ...moved.map((m) => (m.from === targetId ? m.to : m.from)));
    return this.initiatives.getOrThrow(targetId);
  }
}
