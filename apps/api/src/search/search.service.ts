import { Inject, Injectable } from "@nestjs/common";
import { and, cosineDistance, eq, inArray } from "drizzle-orm";
import {
  ALL_EDGE_TYPES,
  halfvecDistance,
  initiativePublicColumns,
  initiatives,
  relatedInitiativeIds,
  sameVectorSize,
  type Db,
  type EdgeType,
  type PublicInitiativeRow,
} from "@scry/db";
import { Subject } from "rxjs";
import type { MessageEvent } from "@nestjs/common";
import { DB } from "../db/db.module";
import { LlmService, type LlmCaller } from "../llm/llm.service";
import type { SearchResult } from "./types";
import { withVectorScan } from "./vector-scan";

@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmService,
  ) {}

  /** Vector-only semantic search over initiative embeddings. */
  async searchSimilarInitiatives(
    queryText: string,
    topK = 10,
    filters?: { teamId?: string },
    caller?: LlmCaller,
  ): Promise<SearchResult[]> {
    const { embedding: queryEmbedding, key } = await this.llm.embedKeyed(queryText, caller);
    // Found through the HNSW index's halfvec distance, then scored and
    // re-sorted by the exact one, so scores don't shift with the index.
    const distance = cosineDistance(initiatives.embedding, queryEmbedding);

    const conditions = [
      // Vectors of another size (mid re-index after a model change) can't be
      // compared. Also the index's predicate, so it must stay this exact form.
      sameVectorSize(queryEmbedding.length),
      // …nor can vectors from another model of the same size.
      eq(initiatives.embeddingKey, key),
      filters?.teamId ? eq(initiatives.teamId, filters.teamId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const found = await withVectorScan(this.db, topK, (tx) =>
      tx
        .select({ initiative: initiativePublicColumns, distance })
        .from(initiatives)
        .where(and(...conditions))
        .orderBy(halfvecDistance(queryEmbedding))
        .limit(topK),
    );
    const rows = found.sort((a, b) => Number(a.distance) - Number(b.distance));

    return rows.map((row) => ({
      initiative: row.initiative,
      provenance: { via: "semantic" as const, score: 1 - Number(row.distance) },
    }));
  }

  /**
   * Existing initiatives that look like a draft someone is typing, judged by
   * the same strong/weak bars as Ask Scry. Merged duplicates and cancelled
   * work are left out: pointing at them wouldn't help anyone.
   */
  async similarTo(text: string, caller?: LlmCaller) {
    const [{ strongMatch, weakMatch }, results] = await Promise.all([
      this.llm.thresholds(),
      this.searchSimilarInitiatives(text, 8, undefined, caller),
    ]);
    return results
      .filter(
        (r) =>
          r.provenance.via === "semantic" &&
          r.provenance.score >= weakMatch &&
          !r.initiative.mergedIntoId &&
          r.initiative.status !== "cancelled",
      )
      .slice(0, 3)
      .map((r) => {
        const score = r.provenance.via === "semantic" ? r.provenance.score : 0;
        return {
          initiative: r.initiative,
          score,
          strength: score >= strongMatch ? ("strong" as const) : ("weak" as const),
        };
      });
  }

  /**
   * What's up to `maxHops` relationship steps from any of the seeds, each
   * with the seed it was reached through (the first, in the order given).
   */
  async getRelatedInitiatives(
    seedIds: string[],
    edgeTypes: EdgeType[] = ALL_EDGE_TYPES,
    maxHops = 1,
  ): Promise<Array<{ initiative: PublicInitiativeRow; hops: number; throughId: string }>> {
    const related = await relatedInitiativeIds(this.db, seedIds, edgeTypes, maxHops);
    if (related.length === 0) return [];

    const rows = await this.db
      .select(initiativePublicColumns)
      .from(initiatives)
      .where(
        inArray(
          initiatives.id,
          related.map((r) => r.id),
        ),
      );

    const byId = new Map(rows.map((r) => [r.id, r]));
    return related.flatMap((r) => {
      const initiative = byId.get(r.id);
      return initiative ? [{ initiative, hops: r.hops, throughId: r.throughId }] : [];
    });
  }

  /**
   * The function the agent actually uses: semantic seeds, expanded by graph
   * traversal, merged and ranked. Every result carries provenance so the
   * agent can cite evidence instead of asserting overlap it can't point to.
   */
  async hybridSearch(
    queryText: string,
    topK = 10,
    expandHops = 1,
    caller?: LlmCaller,
    onPhase?: (event: { phase: string; data?: unknown }) => void,
  ): Promise<SearchResult[]> {
    onPhase?.({ phase: "embedding" });
    const seeds = await this.searchSimilarInitiatives(
      queryText,
      Math.min(topK, 5),
      undefined,
      caller,
    );
    onPhase?.({ phase: "vector_search", data: { matches: seeds.length } });

    const byId = new Map<string, SearchResult>();
    for (const seed of seeds) {
      byId.set(seed.initiative.id, seed);
      onPhase?.({
        phase: "node_found",
        data: { id: seed.initiative.id, ...seed.provenance },
      });
    }

    onPhase?.({ phase: "graph_expand" });
    // Every seed in one query; each related initiative comes back once,
    // through the best-ranked seed that reaches it.
    const seedRank = new Map(seeds.map((seed, i) => [seed.initiative.id, i]));
    const related = (
      await this.getRelatedInitiatives(
        seeds.map((seed) => seed.initiative.id),
        ALL_EDGE_TYPES,
        expandHops,
      )
    ).sort(
      (a, b) =>
        (seedRank.get(a.throughId) ?? 0) - (seedRank.get(b.throughId) ?? 0) || a.hops - b.hops,
    );
    for (const { initiative, hops, throughId } of related) {
      if (byId.has(initiative.id)) continue; // semantic match already ranks it
      byId.set(initiative.id, {
        initiative,
        provenance: { via: "graph", hops, throughInitiativeId: throughId },
      });
      onPhase?.({
        phase: "node_found",
        data: { id: initiative.id, via: "graph", hops, throughInitiativeId: throughId },
      });
    }

    return [...byId.values()]
      .sort((a, b) => {
        const scoreA = a.provenance.via === "semantic" ? a.provenance.score : -a.provenance.hops;
        const scoreB = b.provenance.via === "semantic" ? b.provenance.score : -b.provenance.hops;
        return scoreB - scoreA;
      })
      .slice(0, topK);
  }

  /** Same as hybridSearch, but streamed as SSE-ready phase events. */
  hybridSearchStream(
    queryText: string,
    topK: number,
    expandHops: number,
    caller?: LlmCaller,
  ): Subject<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    this.hybridSearch(queryText, topK, expandHops, caller, (event) => {
      subject.next({ type: event.phase, data: event.data ?? {} });
    })
      .then((results) => {
        // "done" must come after "results": clients close the stream on
        // "done", so anything sent after it is never received.
        subject.next({ type: "results", data: results });
        subject.next({ type: "done", data: {} });
        subject.complete();
      })
      .catch((err: Error) => {
        // An SSE error event the client can show (e.g. "AI isn't set up"),
        // rather than a dropped connection it would retry forever.
        subject.next({ type: "error", data: { message: err.message } });
        subject.complete();
      });

    return subject;
  }
}
