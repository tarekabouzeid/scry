import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  assertBuildMemory,
  createVectorIndexSql,
  halfvecDistance,
  indexesToDrop,
  sameVectorSize,
  vectorIndexName,
} from "./vector-index";

const dialect = new PgDialect();

describe("createVectorIndexSql", () => {
  it("builds a partial HNSW index over the halfvec cast for one size", () => {
    expect(createVectorIndexSql(1536)).toBe(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS initiatives_embedding_hnsw_1536 ON initiatives " +
        "USING hnsw ((embedding::halfvec(1536)) halfvec_cosine_ops) " +
        "WHERE vector_dims(embedding) = 1536",
    );
  });

  it("refuses anything but a sane integer size", () => {
    expect(() => createVectorIndexSql(0)).toThrow();
    expect(() => createVectorIndexSql(1.5)).toThrow();
    expect(() => createVectorIndexSql(Number("1; drop table x"))).toThrow();
  });
});

describe("indexesToDrop", () => {
  it("drops other sizes and an invalid index of this size, and leaves others' indexes alone", () => {
    expect(
      indexesToDrop(
        [
          { name: vectorIndexName(768), valid: true },
          { name: vectorIndexName(1536), valid: true },
          { name: "initiatives_title_idx", valid: true },
        ],
        1536,
      ),
    ).toEqual([vectorIndexName(768)]);
    expect(indexesToDrop([{ name: vectorIndexName(1536), valid: false }], 1536)).toEqual([
      vectorIndexName(1536),
    ]);
  });
});

describe("query helpers", () => {
  it("repeat the index's cast and predicate, with the size as a literal", () => {
    const size = dialect.sqlToQuery(sameVectorSize(3));
    expect(size.sql).toBe('vector_dims("initiatives"."embedding") = 3');
    expect(size.params).toEqual([]);

    const distance = dialect.sqlToQuery(halfvecDistance([0.1, 0.2, 0.3]));
    expect(distance.sql).toBe('("initiatives"."embedding"::halfvec(3) <=> $1::halfvec(3))');
    expect(distance.params).toEqual(["[0.1,0.2,0.3]"]);
  });
});

describe("assertBuildMemory", () => {
  it("accepts Postgres memory sizes", () => {
    expect(assertBuildMemory("512MB")).toBe("512MB");
    expect(assertBuildMemory("2GB")).toBe("2GB");
  });

  it("refuses anything else, since it's interpolated into SET", () => {
    for (const bad of ["1 GB", "1gb", "2GB'; drop table x; --", "", "GB"]) {
      expect(() => assertBuildMemory(bad)).toThrow();
    }
  });
});
