import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  edges,
  initiativeListColumns,
  initiativePublicColumns,
  initiatives,
  teams,
  users,
  type Db,
  type PublicInitiativeRow,
} from "@scry/db";
import { DB } from "../db/db.module";
import { JobsService } from "../jobs/jobs.service";
import { ActivityService } from "../activity/activity.service";
import { NotificationsService } from "../notifications/notifications.service";
import { canEditInitiative } from "../common/permissions";
import { normalizeTags } from "../common/tags";
import type { AuthenticatedUser } from "../auth/types";
import type { CreateInitiativeDto } from "./dto/create-initiative.dto";
import type { UpdateInitiativeDto } from "./dto/update-initiative.dto";
import type {
  CountInitiativesQueryDto,
  ListInitiativesQueryDto,
} from "./dto/list-initiatives.query.dto";
import {
  SORTS,
  decodeCursor,
  encodeCursor,
  filterConditions,
  keysetAfter,
  orderByFor,
  resolveSort,
  sortValueColumns,
} from "./list-query";
import { TagsCache } from "./tags-cache";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type InitiativeListRow = PublicInitiativeRow & { embeddingReady: boolean; signalTeams: number };

// Fields whose changes are worth a line in the activity history.
const TRACKED_FIELDS = [
  "title",
  "summary",
  "tier",
  "teamId",
  "contactPerson",
  "startDate",
  "targetDate",
  "tags",
  "externalLink",
  "holdReason",
] as const;

/** A hold reason only means something while on hold; blank means none. */
function holdReasonFor(status: string, reason: string | null | undefined) {
  return status === "on_hold" ? reason?.trim() || null : null;
}

@Injectable()
export class InitiativesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly tagsCache: TagsCache,
  ) {}

  /** One page, in one of the indexed orders, continuing from `cursor`. */
  async list(query: ListInitiativesQueryDto): Promise<{
    items: InitiativeListRow[];
    nextCursor: string | null;
  }> {
    const { sort, dir } = resolveSort(query.sort, query.dir);
    const limit = query.limit ?? 50;
    const conditions = filterConditions(query);
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor, sort, dir);
      if (!cursor) throw new BadRequestException("That page link is out of date; start again");
      conditions.push(keysetAfter(sort, dir, cursor));
    }

    // One extra row says whether there's a next page.
    const rows = await this.db
      .select({ ...initiativeListColumns, ...sortValueColumns(sort) })
      .from(initiatives)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...orderByFor(sort, dir))
      .limit(limit + 1);

    const keys = SORTS[sort].keys.map((_, i) => `_k${i}`);
    const page = rows.slice(0, limit) as Array<Record<string, unknown>>;
    const items = page.map((row) => {
      const item = { ...row };
      for (const k of keys) delete item[k];
      return item as InitiativeListRow;
    });
    const last = rows.length > limit ? page.at(-1) : undefined;
    const nextCursor = last
      ? encodeCursor({
          sort,
          dir,
          values: keys.map((k) => (last[k] as string | null) ?? null),
          id: last.id as string,
        })
      : null;
    return { items, nextCursor };
  }

  /** How many initiatives match the filters, per status or per team. */
  async counts(query: CountInitiativesQueryDto): Promise<Array<{ key: string; count: number }>> {
    const column = query.groupBy === "team" ? initiatives.teamId : initiatives.status;
    const conditions = filterConditions(query);
    const rows = await this.db
      .select({ key: sql<string>`${column}::text`, count: sql<number>`count(*)::int` })
      .from(initiatives)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(column);
    return rows.map((r) => ({ key: r.key, count: Number(r.count) }));
  }

  /** Several initiatives by id (at most 200), in the order asked; unknown ids are skipped. */
  async lookup(rawIds: string): Promise<InitiativeListRow[]> {
    const ids = [
      ...new Set(
        rawIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length > 200) throw new BadRequestException("Ask for at most 200 initiatives at once");
    if (ids.some((id) => !UUID.test(id))) throw new BadRequestException("ids must be UUIDs");
    if (!ids.length) return [];
    const rows = await this.db
      .select(initiativeListColumns)
      .from(initiatives)
      .where(inArray(initiatives.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is InitiativeListRow => !!r);
  }

  /** Tags in use on live (unmerged) initiatives, most used first. */
  async tagsInUse(): Promise<Array<{ tag: string; count: number }>> {
    const cached = await this.tagsCache.get<Array<{ tag: string; count: number }>>();
    if (cached) return cached;
    const rows = await this.db.execute<{ tag: string; count: number }>(
      sql`select tag, count(*)::int as count from (select unnest(tags) as tag from initiatives where merged_into_id is null) t group by tag order by count(*) desc, tag`,
    );
    const tags = [...rows];
    await this.tagsCache.set(tags);
    return tags;
  }

  async getOrThrow(id: string) {
    const [row] = await this.db
      .select(initiativeListColumns)
      .from(initiatives)
      .where(eq(initiatives.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("Initiative not found");
    return row;
  }

  private assertCanEdit(user: AuthenticatedUser, initiative: PublicInitiativeRow) {
    if (!canEditInitiative(user, initiative)) {
      throw new ForbiddenException(
        "Only the submitter, the contact person, the team's admins or an admin can edit this initiative",
      );
    }
  }

  /**
   * Which team an initiative lands in, and who its contact is, are claims
   * other teams rely on — so they're checked, not just FK-validated:
   * non-admins only file work under their own team, and the contact must be
   * a member of the owning team (or the caller themselves).
   */
  private async assertPlacement(
    user: AuthenticatedUser,
    teamId: string,
    contactPerson: string | null | undefined,
  ) {
    const [team] = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) throw new BadRequestException("Team not found");
    if (user.role !== "admin" && teamId !== user.teamId) {
      throw new ForbiddenException("You can only file initiatives under your own team");
    }
    if (contactPerson && contactPerson !== user.id) {
      const [contact] = await this.db
        .select({ id: users.id, teamId: users.teamId })
        .from(users)
        .where(eq(users.id, contactPerson))
        .limit(1);
      if (!contact) throw new BadRequestException("Contact person not found");
      if (contact.teamId !== teamId) {
        throw new BadRequestException("The contact person must be a member of the owning team");
      }
    }
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateInitiativeDto,
    options: { activityKind?: "created" | "registered_from_chat"; chatSessionId?: string } = {},
  ) {
    if (!dto.teamId && !user.teamId) {
      throw new ForbiddenException("You must belong to a team before submitting an initiative");
    }
    const teamId = dto.teamId ?? user.teamId!;
    await this.assertPlacement(user, teamId, dto.contactPerson);

    const [row] = await this.db
      .insert(initiatives)
      .values({
        title: dto.title.trim(),
        summary: dto.summary.trim(),
        status: dto.status,
        tier: dto.tier,
        teamId,
        submittedBy: user.id,
        contactPerson: dto.contactPerson ?? user.id,
        startDate: dto.startDate,
        targetDate: dto.targetDate,
        tags: normalizeTags(dto.tags ?? []),
        externalLink: dto.externalLink,
        holdReason: holdReasonFor(dto.status ?? "idea", dto.holdReason),
        // embedding filled in asynchronously by the job enqueued below.
      })
      .returning(initiativePublicColumns);

    this.jobs.enqueueEmbedding(row!.id);
    this.jobs.enqueueTldr(row!.id);
    if (row!.tags.length) await this.tagsCache.clear();
    await this.activity.log(
      row!.id,
      user.id,
      options.activityKind ?? "created",
      options.chatSessionId ? { chatSessionId: options.chatSessionId } : {},
    );

    return { ...row!, embeddingReady: false };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateInitiativeDto) {
    const existing = await this.getOrThrow(id);
    this.assertCanEdit(user, existing);
    const teamChanged = dto.teamId !== undefined && dto.teamId !== existing.teamId;
    const contactChanged =
      dto.contactPerson !== undefined &&
      dto.contactPerson !== null &&
      dto.contactPerson !== existing.contactPerson;
    if (teamChanged && user.role !== "admin") {
      throw new ForbiddenException("Only an admin can move an initiative to another team");
    }
    if (teamChanged || contactChanged) {
      // Owners of an initiative filed before they changed teams can still
      // pick its contact: check against the initiative's team, not theirs.
      await this.assertPlacement(
        user.role === "admin" ? user : { ...user, teamId: existing.teamId },
        dto.teamId ?? existing.teamId,
        contactChanged ? dto.contactPerson : undefined,
      );
    }

    const patch = {
      ...dto,
      ...(dto.title !== undefined && { title: dto.title.trim() }),
      ...(dto.summary !== undefined && { summary: dto.summary.trim() }),
      ...(dto.tags !== undefined && { tags: normalizeTags(dto.tags ?? []) }),
      holdReason: holdReasonFor(
        dto.status ?? existing.status,
        dto.holdReason !== undefined ? dto.holdReason : existing.holdReason,
      ),
    };

    const [row] = await this.db
      .update(initiatives)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(initiatives.id, id))
      .returning(initiativePublicColumns);

    // Re-embed only when the text that feeds the embedding actually changed
    // — cheap to check, saves a job (and an LLM call) on every unrelated edit.
    const textChanged = row!.title !== existing.title || row!.summary !== existing.summary;
    if (textChanged) this.jobs.enqueueEmbedding(row!.id);
    if (JSON.stringify(row!.tags) !== JSON.stringify(existing.tags)) await this.tagsCache.clear();
    // Its TL;DR, and — when its title or status changed — the TL;DRs of
    // work that names it as a dependency. Unchanged inputs cost nothing.
    this.jobs.enqueueTldr(row!.id);
    if (row!.title !== existing.title || row!.status !== existing.status) {
      const linked = await this.db
        .select({ from: edges.fromInitiativeId, to: edges.toInitiativeId })
        .from(edges)
        .where(or(eq(edges.fromInitiativeId, id), eq(edges.toInitiativeId, id)));
      this.jobs.enqueueTldr(...linked.map((l) => (l.from === id ? l.to : l.from)));
    }

    if (row!.status !== existing.status) {
      await this.activity.log(id, user.id, "status_changed", {
        from: existing.status,
        to: row!.status,
      });
      await this.notifications.notify({
        kind: "status_changed",
        initiative: row!,
        actor: user,
        // Work going on hold is what other teams need to hear about right away.
        includeOwners: row!.status === "on_hold",
        text: `"${row!.title}" moved from ${existing.status.replace("_", " ")} to ${row!.status.replace("_", " ")}`,
        data: { from: existing.status, to: row!.status },
      });
    }
    const changed = TRACKED_FIELDS.filter(
      (f) => JSON.stringify(row![f]) !== JSON.stringify(existing[f]),
    );
    if (changed.length) {
      await this.activity.log(id, user.id, "updated", { fields: changed });
    }

    return { ...row!, embeddingReady: textChanged ? false : existing.embeddingReady };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.getOrThrow(id);
    if (user.role !== "admin" && existing.submittedBy !== user.id) {
      throw new ForbiddenException("Only the submitter or an admin can delete this initiative");
    }
    await this.db.delete(initiatives).where(eq(initiatives.id, id));
  }

  /**
   * Bulk create from an import (CSV / Jira export, mapped client-side).
   * Rows are independent: one bad row is reported, not fatal to the rest.
   */
  async importMany(user: AuthenticatedUser, rows: CreateInitiativeDto[]) {
    const errors: { row: number; message: string }[] = [];
    let created = 0;
    for (const [index, row] of rows.entries()) {
      try {
        await this.create(user, row);
        created++;
      } catch (err) {
        errors.push({ row: index + 1, message: (err as Error).message });
      }
    }
    return { created, errors };
  }
}
