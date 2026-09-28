import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "bullmq";
import { eq, inArray, or } from "drizzle-orm";
import { edges, initiativeSignals, initiatives, teams, type Db } from "@scry/db";
import Redis from "ioredis";
import { DB } from "../db/db.module";
import { LlmService } from "../llm/llm.service";
import { JobsService } from "./jobs.service";
import { REDIS_CONNECTION } from "./queue.module";
import {
  DEFAULT_TLDR_CONCURRENCY,
  TLDR_PER_SECOND,
  TLDR_QUEUE,
  concurrencyFrom,
  type GenerateTldrJob,
} from "./jobs.constants";
import { TLDR_SYSTEM, tldrPrompt, tldrSchema, tldrSource, type TldrInput } from "./tldr.prompt";

const OPEN = new Set(["idea", "planned", "in_progress", "on_hold"]);

@Injectable()
export class TldrProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TldrProcessor.name);
  private worker?: Worker<GenerateTldrJob>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly llm: LlmService,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {}

  /** The facts a TL;DR is written from: the initiative, its team, and which teams connect to it. */
  async inputFor(initiativeId: string): Promise<TldrInput | null> {
    const [row] = await this.db
      .select({
        id: initiatives.id,
        title: initiatives.title,
        summary: initiatives.summary,
        status: initiatives.status,
        tier: initiatives.tier,
        holdReason: initiatives.holdReason,
        mergedIntoId: initiatives.mergedIntoId,
        team: teams.name,
      })
      .from(initiatives)
      .innerJoin(teams, eq(teams.id, initiatives.teamId))
      .where(eq(initiatives.id, initiativeId))
      .limit(1);
    if (!row || row.mergedIntoId) return null;

    const links = await this.db
      .select({ from: edges.fromInitiativeId, to: edges.toInitiativeId, type: edges.type })
      .from(edges)
      .where(or(eq(edges.fromInitiativeId, row.id), eq(edges.toInitiativeId, row.id)));
    const buildsOn: string[] = [];
    const builtOnBy: string[] = [];
    for (const l of links) {
      if (l.type !== "builds_on") continue;
      if (l.from === row.id) buildsOn.push(l.to);
      else builtOnBy.push(l.from);
    }
    const otherIds = [...new Set([...buildsOn, ...builtOnBy])];
    const others = otherIds.length
      ? await this.db
          .select({
            id: initiatives.id,
            title: initiatives.title,
            status: initiatives.status,
            team: teams.name,
          })
          .from(initiatives)
          .innerJoin(teams, eq(teams.id, initiatives.teamId))
          .where(inArray(initiatives.id, otherIds))
      : [];
    // What it builds on may be shipped; work building on it counts only while
    // it's still open (finished or cancelled work no longer needs it).
    const label = (id: string, statuses: Set<string> | null) => {
      const o = others.find((x) => x.id === id);
      return o && o.status !== "cancelled" && (!statuses || statuses.has(o.status))
        ? `${o.title} (${o.team})`
        : null;
    };
    const asked = await this.db
      .selectDistinct({ team: teams.name })
      .from(initiativeSignals)
      .innerJoin(teams, eq(teams.id, initiativeSignals.teamId))
      .where(eq(initiativeSignals.initiativeId, row.id));

    return {
      title: row.title,
      summary: row.summary,
      status: row.status,
      tier: row.tier,
      team: row.team,
      holdReason: row.status === "on_hold" ? row.holdReason : null,
      buildsOn: buildsOn
        .map((id) => label(id, null))
        .filter((x): x is string => !!x)
        .sort(),
      builtOnBy: builtOnBy
        .map((id) => label(id, OPEN))
        .filter((x): x is string => !!x)
        .sort(),
      askedForBy: asked
        .map((a) => a.team)
        .filter((t) => t !== row.team)
        .sort(),
    };
  }

  onModuleInit() {
    this.worker = new Worker<GenerateTldrJob>(
      TLDR_QUEUE,
      async (job) => {
        if (!(await this.llm.isConfigured())) return;
        const input = await this.inputFor(job.data.initiativeId);
        if (!input) return;
        const source = tldrSource(input);
        const [current] = await this.db
          .select({ tldrSource: initiatives.tldrSource })
          .from(initiatives)
          .where(eq(initiatives.id, job.data.initiativeId))
          .limit(1);
        if (current?.tldrSource === source) return; // nothing it's written from has changed

        const { tldr } = await this.llm.object("tasks", {
          schema: tldrSchema,
          system: TLDR_SYSTEM,
          prompt: tldrPrompt(input),
        });
        const text = tldr.replace(/\s+/g, " ").trim();
        if (!text) return;
        await this.db
          .update(initiatives)
          .set({ tldr: text.slice(0, 300), tldrSource: source, tldrAt: new Date() })
          .where(eq(initiatives.id, job.data.initiativeId));
      },
      {
        connection: this.connection,
        concurrency: concurrencyFrom(
          this.config.get<string>("TLDR_CONCURRENCY"),
          DEFAULT_TLDR_CONCURRENCY,
        ),
        // TL;DRs are background polish: a backfill mustn't become a burst of model calls.
        limiter: { max: TLDR_PER_SECOND, duration: 1000 },
      },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`TL;DR job ${job?.id} failed: ${err.message}`);
    });
    void this.backfillOnBoot();
  }

  private async backfillOnBoot() {
    try {
      if (await this.llm.isConfigured()) await this.jobs.backfillTldrs();
    } catch (err) {
      this.logger.warn(`TL;DR backfill skipped: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
