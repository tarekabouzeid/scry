import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  decodeCursor,
  encodeCursor,
  escapeLike,
  filterConditions,
  keysetAfter,
  orderByFor,
  resolveSort,
  searchWords,
  type Cursor,
} from "./list-query";

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);
const ID = "0b6f1e1c-1d2e-4f3a-9b8c-7d6e5f4a3b2c";

describe("resolveSort", () => {
  it("defaults to most recently updated first", () => {
    expect(resolveSort()).toEqual({ sort: "updated", dir: "desc" });
  });
  it("gives each order its natural direction", () => {
    expect(resolveSort("title")).toEqual({ sort: "title", dir: "asc" });
    expect(resolveSort("status")).toEqual({ sort: "status", dir: "asc" });
    expect(resolveSort("target")).toEqual({ sort: "target", dir: "asc" });
    expect(resolveSort("target", "desc")).toEqual({ sort: "target", dir: "desc" });
  });
});

describe("cursor codec", () => {
  const cursor: Cursor = {
    sort: "updated",
    dir: "desc",
    values: ["2026-09-27 10:00:00.123456+00"],
    id: ID,
  };

  it("round-trips, keeping microseconds", () => {
    const raw = encodeCursor(cursor);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // safe in a query string
    expect(decodeCursor(raw, "updated", "desc")).toEqual(cursor);
  });

  it("refuses a cursor made for another order or direction", () => {
    const raw = encodeCursor(cursor);
    expect(decodeCursor(raw, "title", "desc")).toBeNull();
    expect(decodeCursor(raw, "updated", "asc")).toBeNull();
  });

  it("refuses garbage and tampering", () => {
    expect(decodeCursor("not-a-cursor", "updated", "desc")).toBeNull();
    expect(decodeCursor("", "updated", "desc")).toBeNull();
    const bad = (value: unknown) =>
      decodeCursor(Buffer.from(JSON.stringify(value)).toString("base64url"), "updated", "desc");
    expect(bad(["updated", "desc", ["x"], "not-a-uuid"])).toBeNull();
    expect(bad(["updated", "desc", ["x", "y"], ID])).toBeNull();
    expect(bad(["updated", "desc", [null], ID])).toBeNull(); // updated_at is never null
    expect(bad(["updated", "desc", [42], ID])).toBeNull();
    expect(bad({ sort: "updated" })).toBeNull();
  });

  it("allows null only where the column can be null", () => {
    const undated: Cursor = { sort: "target", dir: "asc", values: [null], id: ID };
    expect(decodeCursor(encodeCursor(undated), "target", "asc")).toEqual(undated);
  });

  it("carries both keys of the status order", () => {
    const c: Cursor = {
      sort: "status",
      dir: "asc",
      values: ["planned", "2026-01-01 00:00:00+00"],
      id: ID,
    };
    expect(decodeCursor(encodeCursor(c), "status", "asc")).toEqual(c);
    expect(decodeCursor(encodeCursor({ ...c, values: ["planned"] }), "status", "asc")).toBeNull();
  });
});

describe("orderByFor", () => {
  const order = (sort: Parameters<typeof orderByFor>[0], dir: "asc" | "desc") =>
    orderByFor(sort, dir).map((q) => render(q).sql);

  it("breaks ties by id in the same direction", () => {
    expect(order("updated", "desc")).toEqual([
      '"initiatives"."updated_at" desc',
      '"initiatives"."id" desc',
    ]);
    expect(order("title", "asc")).toEqual(['"initiatives"."title" asc', '"initiatives"."id" asc']);
  });

  it("keeps the newest first within each status", () => {
    expect(order("status", "asc")).toEqual([
      '"initiatives"."status" asc',
      '"initiatives"."updated_at" desc',
      '"initiatives"."id" desc',
    ]);
    expect(order("status", "desc")).toEqual([
      '"initiatives"."status" desc',
      '"initiatives"."updated_at" asc',
      '"initiatives"."id" asc',
    ]);
  });

  it("puts undated work last either way", () => {
    expect(order("target", "asc")[0]).toBe('"initiatives"."target_date" asc nulls last');
    expect(order("target", "desc")[0]).toBe('"initiatives"."target_date" desc nulls last');
  });
});

describe("keysetAfter", () => {
  it("uses one row comparison when every key runs the same way", () => {
    const q = render(
      keysetAfter("updated", "desc", {
        sort: "updated",
        dir: "desc",
        values: ["2026-09-27 10:00:00.123456+00"],
        id: ID,
      }),
    );
    expect(q.sql).toBe(
      '("initiatives"."updated_at", "initiatives"."id") < ($1::timestamptz, $2::uuid)',
    );
    expect(q.params).toEqual(["2026-09-27 10:00:00.123456+00", ID]);

    const title = render(
      keysetAfter("title", "asc", { sort: "title", dir: "asc", values: ["Passkeys"], id: ID }),
    );
    expect(title.sql).toBe('("initiatives"."title", "initiatives"."id") > ($1::text, $2::uuid)');
  });

  it("spells out mixed directions key by key", () => {
    const q = render(
      keysetAfter("status", "asc", {
        sort: "status",
        dir: "asc",
        values: ["planned", "2026-01-01 00:00:00+00"],
        id: ID,
      }),
    );
    expect(q.sql).toBe(
      '(("initiatives"."status" > $1::initiative_status or ("initiatives"."status" = $2::initiative_status and "initiatives"."updated_at" < $3::timestamptz) or ("initiatives"."status" = $4::initiative_status and "initiatives"."updated_at" = $5::timestamptz and "initiatives"."id" < $6::uuid)))',
    );
  });

  it("after a dated row, later dates and then the undated ones follow", () => {
    const q = render(
      keysetAfter("target", "asc", {
        sort: "target",
        dir: "asc",
        values: ["2026-10-01"],
        id: ID,
      }),
    );
    expect(q.sql).toBe(
      '((("initiatives"."target_date" > $1::date or "initiatives"."target_date" is null) or ("initiatives"."target_date" = $2::date and "initiatives"."id" > $3::uuid)))',
    );
  });

  it("after an undated row, only other undated rows follow", () => {
    const q = render(
      keysetAfter("target", "desc", { sort: "target", dir: "desc", values: [null], id: ID }),
    );
    expect(q.sql).toBe('(("initiatives"."target_date" is null and "initiatives"."id" < $1::uuid))');
  });
});

describe("filters", () => {
  it("splits a search into words that must all match", () => {
    expect(searchWords("  customer   analytics ")).toEqual(["customer", "analytics"]);
    expect(searchWords("")).toEqual([]);
    expect(searchWords(undefined)).toEqual([]);
    expect(searchWords("a b c d e f g h i j")).toHaveLength(8);
  });

  it("matches wildcards literally", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
  });

  it("builds one condition per filter", () => {
    const conditions = filterConditions({
      teamId: ID,
      status: "planned",
      search: "dark mode",
      tag: " UI ",
      from: "2026-01-01",
      to: "2026-12-31",
    }).map((c) => render(c));
    expect(conditions).toHaveLength(7);
    const tag = conditions.find((c) => c.sql.includes("@>") && !c.sql.includes("ilike"))!;
    expect(tag.params).toEqual(["ui"]);
    expect(conditions.filter((c) => c.sql.includes("ilike"))).toHaveLength(2);
  });

  it("can leave out a team's work and merged duplicates", () => {
    const [notTeam, unmerged] = filterConditions({ notTeamId: ID, unmerged: true }).map(render);
    expect(notTeam!.sql).toBe('"initiatives"."team_id" <> $1');
    expect(unmerged!.sql).toBe('"initiatives"."merged_into_id" is null');
  });

  it("lets a search word match a whole tag too", () => {
    const [word] = filterConditions({ search: "Passkeys" }).map(render);
    expect(word!.sql).toContain("@>");
    expect(word!.params).toContain("passkeys");
  });

  it("builds nothing when nothing is filtered", () => {
    expect(filterConditions({})).toEqual([]);
    expect(filterConditions({ search: "   ", tag: " " })).toEqual([]);
  });
});
