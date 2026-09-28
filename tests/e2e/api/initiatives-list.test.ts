import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { as, initiativeId, resetDemo, sql } from "../support/scry";

type Bob = Awaited<ReturnType<typeof as>>;
let bob: Bob;
let total: number;

const LIFECYCLE = ["idea", "planned", "in_progress", "on_hold", "shipped", "cancelled"];

beforeAll(async () => {
  await resetDemo();
  bob = await as("bob");
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from initiatives`;
  total = n;
});

/** Follow the cursor to the end, a few rows at a time. */
async function everyPage(query: string, limit = 5) {
  const ids: string[] = [];
  const rows: any[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r: { status: number; data: any } = await bob.call(
      "GET",
      `/initiatives?${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.items.length).toBeLessThanOrEqual(limit);
    rows.push(...r.data.items);
    ids.push(...r.data.items.map((i: any) => i.id));
    cursor = r.data.nextCursor;
    pages++;
  } while (cursor && pages < 100);
  return { ids, rows, pages };
}

describe("GET /initiatives", () => {
  it("returns the first page, most recently updated first", async () => {
    const r = await bob.call("GET", "/initiatives");
    expect(r.status).toBe(200);
    expect(r.data.nextCursor).toBeNull(); // the demo fits in one page of 50
    expect(r.data.items).toHaveLength(total);
    const times = r.data.items.map((i: any) => Date.parse(i.updatedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(r.data.items[0]).toHaveProperty("signalTeams");
    expect(r.data.items[0]).not.toHaveProperty("_k0");
  });

  it.each(["sort=updated", "sort=title", "sort=status", "sort=target", "sort=target&dir=desc"])(
    "pages through every row exactly once (%s)",
    async (query) => {
      const { ids, pages } = await everyPage(query);
      expect(pages).toBeGreaterThan(1);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(total);
    },
  );

  it("sorts statuses by lifecycle, newest first within each", async () => {
    const { rows } = await everyPage("sort=status", 4);
    const order = rows.map((i) => LIFECYCLE.indexOf(i.status));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (let k = 1; k < rows.length; k++) {
      if (rows[k].status === rows[k - 1].status) {
        expect(Date.parse(rows[k].updatedAt)).toBeLessThanOrEqual(
          Date.parse(rows[k - 1].updatedAt),
        );
      }
    }
  });

  it("puts undated work last whichever the direction", async () => {
    for (const dir of ["asc", "desc"]) {
      const { rows } = await everyPage(`sort=target&dir=${dir}`, 3);
      const firstUndated = rows.findIndex((i) => !i.targetDate);
      if (firstUndated >= 0)
        expect(rows.slice(firstUndated).every((i) => !i.targetDate)).toBe(true);
      const dated = rows.filter((i) => i.targetDate).map((i) => i.targetDate as string);
      const sorted = [...dated].sort();
      expect(dated).toEqual(dir === "asc" ? sorted : sorted.reverse());
    }
  });

  it("sorts titles A–Z and back", async () => {
    const asc = (await everyPage("sort=title&dir=asc", 6)).rows.map((i) => i.id);
    const desc = (await everyPage("sort=title&dir=desc", 6)).rows.map((i) => i.id);
    expect(desc).toEqual([...asc].reverse());
  });

  it("filters by every word of a search, and by tag", async () => {
    const r = await bob.call("GET", "/initiatives?search=analytics%20dashboards");
    expect(r.data.items.length).toBeGreaterThanOrEqual(2);
    for (const i of r.data.items) {
      // A word matches the title, the summary or a whole tag.
      const text = `${i.title} ${i.summary} ${i.tags.join(" ")}`.toLowerCase();
      expect(text).toContain("analytics");
      expect(text).toContain("dashboards");
    }
    // (The tags endpoint is cached for a minute, so ask the database.)
    const [{ tag, n }] = await sql<{ tag: string; n: number }[]>`
      select tag, count(*)::int as n from (select unnest(tags) as tag from initiatives) t
      group by tag order by count(*) desc, tag limit 1`;
    const tagged = (await bob.call("GET", `/initiatives?tag=${encodeURIComponent(tag)}`)).data;
    expect(tagged.items).toHaveLength(n);
    expect(tagged.items.every((i: any) => i.tags.includes(tag))).toBe(true);
  });

  it("finds work by a tag typed into the search", async () => {
    const id = await initiativeId("Passkeys for customer login");
    await sql`update initiatives set tags = array['zz-only-a-tag'] where id = ${id}`;
    const r = await bob.call("GET", "/initiatives?search=ZZ-only-a-tag");
    expect(r.data.items.map((i: any) => i.id)).toEqual([id]);
  });

  it("can leave out a team's work and merged duplicates, for pickers", async () => {
    const r = await bob.call(
      "GET",
      `/initiatives?notTeamId=${bob.user.team_id}&unmerged=true&limit=200`,
    );
    expect(r.status).toBe(200);
    expect(r.data.items.length).toBeGreaterThan(0);
    for (const i of r.data.items) {
      expect(i.teamId).not.toBe(bob.user.team_id);
      expect(i.mergedIntoId).toBeNull();
    }
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from initiatives
      where team_id <> ${bob.user.team_id} and merged_into_id is null`;
    expect(r.data.items).toHaveLength(n);
  });

  it("finds dated work that touches a window", async () => {
    const r = await bob.call("GET", "/initiatives?from=2000-01-01&to=2100-01-01&limit=200");
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from initiatives
      where start_date is not null or target_date is not null`;
    expect(r.data.items).toHaveLength(n);
    const none = await bob.call("GET", "/initiatives?from=1990-01-01&to=1990-02-01");
    expect(none.data.items).toHaveLength(0);
  });

  it("refuses bad paging input", async () => {
    const first = await bob.call("GET", "/initiatives?sort=title&limit=2");
    const cursor = first.data.nextCursor as string;
    expect(cursor).toBeTruthy();
    expect((await bob.call("GET", `/initiatives?sort=updated&cursor=${cursor}`)).status).toBe(400);
    expect((await bob.call("GET", "/initiatives?cursor=nonsense")).status).toBe(400);
    expect((await bob.call("GET", "/initiatives?limit=201")).status).toBe(400);
    expect((await bob.call("GET", "/initiatives?limit=0")).status).toBe(400);
    expect((await bob.call("GET", "/initiatives?sort=team")).status).toBe(400);
  });
});

describe("GET /initiatives/counts", () => {
  it("counts per status and per team, with the list's filters", async () => {
    const byStatus = (await bob.call("GET", "/initiatives/counts?groupBy=status")).data;
    expect(byStatus.reduce((sum: number, c: any) => sum + c.count, 0)).toBe(total);
    const onHold = byStatus.find((c: any) => c.key === "on_hold");
    const list = (await bob.call("GET", "/initiatives?status=on_hold")).data.items;
    expect(onHold.count).toBe(list.length);

    const byTeam = (await bob.call("GET", "/initiatives/counts?groupBy=team")).data;
    expect(byTeam.reduce((sum: number, c: any) => sum + c.count, 0)).toBe(total);
    expect((await bob.call("GET", "/initiatives/counts")).status).toBe(400);
  });
});

describe("GET /initiatives/lookup", () => {
  it("returns the asked-for initiatives in order, skipping unknown ids", async () => {
    const a = await initiativeId("Feature store");
    const b = await initiativeId("Passkeys for customer login");
    const r = await bob.call("GET", `/initiatives/lookup?ids=${b},${randomUUID()},${a},${b}`);
    expect(r.status).toBe(200);
    expect(r.data.map((i: any) => i.id)).toEqual([b, a]);
  });

  it("refuses bad or too many ids", async () => {
    expect((await bob.call("GET", "/initiatives/lookup?ids=nope")).status).toBe(400);
    const many = Array.from({ length: 201 }, () => randomUUID()).join(",");
    expect((await bob.call("GET", `/initiatives/lookup?ids=${many}`)).status).toBe(400);
  });
});
