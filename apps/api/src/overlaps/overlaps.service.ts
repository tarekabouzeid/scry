import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, cosineDistance, desc, eq, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import {
  edges,
  halfvecDistance,
  initiatives,
  mergeRequests,
  overlaps,
  sameVectorSize,
  type Db,
} from "@scry/db";
import { DB } from "../db/db.module";
import { withVectorScan } from "../search/vector-scan";
import type { AuthenticatedUser } from "../auth/types";
import { ActivityService } from "../activity/activity.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LlmSettingsService } from "../llm/llm-settings.service";
import { orderPair } from "./pair";

const MAX_OVERLAPS_PER_RUN = 5;
/** Open overlaps returned by default: the strongest first. */
export const OPEN_OVERLAPS_LIMIT = 100;
export const OPEN_OVERLAPS_MAX = 500;

@Injectable()
export class OverlapsService {
  private readonly logger = new Logger(OverlapsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llmSettings: LlmSettingsService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Admin-set in AI & models (defaults to the chat agent's strong-match bar). */
  private async threshold() {
    return (await this.llmSettings.active()).settings.matching.overlap;
  }

  /**
   * Called after an initiative is (re-)embedded: finds other teams'
   * initiatives that are semantically near-identical and aren't already
   * explicitly related, records each pair once, and tells both sides.
   */
  async detectFor(initiativeId: string): Promise<number> {
    const [subject] = await this.db
      .select()
      .from(initiatives)
      .where(eq(initiatives.id, initiativeId))
      .limit(1);
    if (!subject?.embedding || !subject.embeddingKey || subject.status === "cancelled") return 0;

    // Walks the HNSW index (halfvec distance, same-size predicate); the
    // threshold and order use the exact distance.
    const distance = cosineDistance(initiatives.embedding, subject.embedding);
    const maxDistance = 1 - (await this.threshold());
    const candidates = (
      await withVectorScan(this.db, MAX_OVERLAPS_PER_RUN, (tx) =>
        tx
          .select({
            id: initiatives.id,
            title: initiatives.title,
            teamId: initiatives.teamId,
            tags: initiatives.tags,
            submittedBy: initiatives.submittedBy,
            contactPerson: initiatives.contactPerson,
            distance,
          })
          .from(initiatives)
          .where(
            and(
              sameVectorSize(subject.embedding!.length),
              // Only vectors from the same model are comparable.
              eq(initiatives.embeddingKey, subject.embeddingKey!),
              ne(initiatives.id, subject.id),
              // Same-team near-duplicates are that team's own business; the
              // point of Scry is catching collisions *across* teams.
              ne(initiatives.teamId, subject.teamId),
              notInArray(initiatives.status, ["cancelled"]),
              sql`(${distance}) <= ${maxDistance}`,
            ),
          )
          .orderBy(halfvecDistance(subject.embedding!))
          .limit(MAX_OVERLAPS_PER_RUN),
      )
    ).sort((a, b) => Number(a.distance) - Number(b.distance));

    // Pairs already explicitly related have nothing to flag: one lookup for all candidates.
    const candidateIds = candidates.map((c) => c.id);
    const related = new Set<string>();
    if (candidateIds.length) {
      const links = await this.db
        .select({ from: edges.fromInitiativeId, to: edges.toInitiativeId })
        .from(edges)
        .where(
          or(
            and(
              eq(edges.fromInitiativeId, subject.id),
              inArray(edges.toInitiativeId, candidateIds),
            ),
            and(
              eq(edges.toInitiativeId, subject.id),
              inArray(edges.fromInitiativeId, candidateIds),
            ),
          ),
        );
      for (const l of links) related.add(l.from === subject.id ? l.to : l.from);
    }

    let created = 0;
    for (const other of candidates) {
      if (related.has(other.id)) continue;

      const score = 1 - Number(other.distance);
      const [a, b] = orderPair(subject.id, other.id);
      const inserted = await this.db
        .insert(overlaps)
        .values({ initiativeAId: a, initiativeBId: b, score })
        .onConflictDoUpdate({
          target: [overlaps.initiativeAId, overlaps.initiativeBId],
          // Keep a human's dismissal; just refresh the score.
          set: { score, updatedAt: new Date() },
        })
        .returning({
          id: overlaps.id,
          createdAt: overlaps.createdAt,
          updatedAt: overlaps.updatedAt,
        });
      const row = inserted[0];
      // createdAt === updatedAt only on the first insert — only then announce it.
      if (!row || row.createdAt.getTime() !== row.updatedAt.getTime()) continue;
      created++;

      const pct = Math.round(score * 100);
      await this.activity.log(subject.id, null, "overlap_detected", {
        otherInitiativeId: other.id,
        score,
      });
      await this.activity.log(other.id, null, "overlap_detected", {
        otherInitiativeId: subject.id,
        score,
      });
      await this.notifications.notify({
        kind: "overlap_detected",
        initiative: subject,
        actor: null,
        includeOwners: true,
        text: `Possible overlap (${pct}%): "${subject.title}" looks like another team's "${other.title}"`,
        data: { overlapId: row.id, otherInitiativeId: other.id },
      });
      await this.notifications.notify({
        kind: "overlap_detected",
        initiative: other,
        actor: null,
        includeOwners: true,
        text: `Possible overlap (${pct}%): your "${other.title}" looks like another team's "${subject.title}"`,
        data: { overlapId: row.id, otherInitiativeId: subject.id },
      });
    }
    if (created) this.logger.log(`Flagged ${created} overlap(s) for initiative ${subject.id}`);
    return created;
  }

  /** Unresolved overlaps, strongest first (served by the (status, score desc) index). */
  async listOpen(limit = OPEN_OVERLAPS_LIMIT) {
    return this.db
      .select()
      .from(overlaps)
      .where(eq(overlaps.status, "open"))
      .orderBy(desc(overlaps.score), overlaps.id)
      .limit(Math.min(Math.max(1, limit), OPEN_OVERLAPS_MAX));
  }

  /** Every open overlap involving any of `ids` (what's on screen), strongest first. */
  async listOpenFor(ids: string[]) {
    return this.db
      .select()
      .from(overlaps)
      .where(
        and(
          eq(overlaps.status, "open"),
          or(inArray(overlaps.initiativeAId, ids), inArray(overlaps.initiativeBId, ids)),
        ),
      )
      .orderBy(desc(overlaps.score), overlaps.id);
  }

  /** How many are waiting for a decision, for the banner (the list itself is capped). */
  async countOpen(): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(overlaps)
      .where(eq(overlaps.status, "open"));
    return row?.n ?? 0;
  }

  /** Mark a pair as dismissed/linked (or reopen it). Either side's owners or an admin. */
  async resolve(user: AuthenticatedUser, id: string, status: "open" | "dismissed" | "linked") {
    const [row] = await this.db.select().from(overlaps).where(eq(overlaps.id, id)).limit(1);
    if (!row) throw new NotFoundException("Overlap not found");

    if (user.role !== "admin") {
      const pair = await this.db
        .select({ teamId: initiatives.teamId })
        .from(initiatives)
        .where(or(eq(initiatives.id, row.initiativeAId), eq(initiatives.id, row.initiativeBId)));
      if (!pair.some((p) => p.teamId === user.teamId)) {
        throw new ForbiddenException("Only members of either team or an admin can resolve this");
      }
    }

    const [updated] = await this.db
      .update(overlaps)
      .set({ status, resolvedBy: status === "open" ? null : user.id, updatedAt: new Date() })
      .where(eq(overlaps.id, id))
      .returning();
    if (status !== "open") {
      await this.closeMergeRequests(row.initiativeAId, row.initiativeBId, user, status);
    }
    return updated!;
  }

  /**
   * A pair settled as not a duplicate (or as related) can't be merged, so
   * an open request to merge them is closed, and whoever asked is told.
   */
  private async closeMergeRequests(
    a: string,
    b: string,
    user: Pick<AuthenticatedUser, "id">,
    status: "dismissed" | "linked",
  ) {
    const closed = await this.db
      .update(mergeRequests)
      .set({ status: "withdrawn", decidedBy: user.id, decidedAt: new Date() })
      .where(
        and(
          eq(mergeRequests.status, "pending"),
          or(
            and(eq(mergeRequests.sourceId, a), eq(mergeRequests.targetId, b)),
            and(eq(mergeRequests.sourceId, b), eq(mergeRequests.targetId, a)),
          ),
        ),
      )
      .returning();
    for (const request of closed) {
      if (!request.requestedBy) continue;
      await this.notifications.notifyPeople({
        userIds: [request.requestedBy],
        kind: "merge_update",
        initiativeId: request.sourceId,
        actor: user,
        text: `Your request to merge was closed: the two were marked ${
          status === "linked" ? "related, not the same" : "not a duplicate"
        }`,
        data: { requestId: request.id, otherInitiativeId: request.targetId, status: "withdrawn" },
      });
    }
  }

  /** An explicit edge between a flagged pair settles it. */
  async markLinked(fromId: string, toId: string, userId: string) {
    const [a, b] = orderPair(fromId, toId);
    await this.db
      .update(overlaps)
      .set({ status: "linked", resolvedBy: userId, updatedAt: new Date() })
      .where(and(eq(overlaps.initiativeAId, a), eq(overlaps.initiativeBId, b)));
    await this.closeMergeRequests(a, b, { id: userId }, "linked");
  }
}
