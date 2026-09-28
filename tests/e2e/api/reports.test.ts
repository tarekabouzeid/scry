import { beforeAll, describe, expect, it } from "vitest";
import { as, connectDemoLlm, initiativeId, resetDemo, sql } from "../support/scry";

let passkeys: string;
let referral: string;
let featureStore: string;
let darkMode: string;

beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
  passkeys = await initiativeId("Passkeys for customer login");
  referral = await initiativeId("Referral program v2");
  featureStore = await initiativeId("Feature store");
  darkMode = await initiativeId("Dark mode everywhere");
});

describe("portfolio brief", () => {
  it("adds up", async () => {
    const { status, data } = await (await as("bob")).call("GET", "/reports/brief");
    expect(status).toBe(200);
    expect(data.days).toBe(90);
    const counted = Object.values(data.totals.byStatus as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(counted).toBe(data.totals.live);
    expect(data.teams.reduce((n: number, t: any) => n + t.total, 0)).toBe(data.totals.live);
    expect(data.totals.byStatus.cancelled).toBe(0);
  });

  it("opens with sentences computed from its own figures", async () => {
    const { data } = await (await as("bob")).call("GET", "/reports/brief");
    expect(data.summary[0]).toMatch(/^\d+ new initiatives? in the last 90 days/);
    expect(data.summary).toContain(
      "“Customer analytics dashboards for account managers” (Growth) and “Self-serve customer analytics dashboards” (Data & ML) look like the same work; nobody has decided yet.",
    );
  });

  it("lists decisions, duplicates first, each with who to talk to", async () => {
    const { data } = await (await as("bob")).call("GET", "/reports/brief?days=0");
    expect(data.decisions.length).toBeLessThanOrEqual(5);
    expect(data.decisions[0]).toMatchObject({ kind: "duplicate", value: 87 });
    expect(data.decisions[0].initiative.contactName).toBeTruthy();
    const kinds = data.decisions.map((d: any) => [d.kind, d.initiative.id]);
    // Wanted by Growth and Payments, but still an idea.
    expect(kinds).toContainEqual(["uncommitted_demand", darkMode]);
    // Growth and Payments build on it, and it has gone quiet.
    expect(kinds).toContainEqual(["at_risk", featureStore]);
    // On hold, and Growth's referral programme builds on it.
    expect(kinds).toContainEqual(["at_risk", passkeys]);
  });

  it("counts demand by team, asked or building on it, and lets old requests fade", async () => {
    const { data } = await (await as("bob")).call("GET", "/reports/brief?days=0");
    const store = data.wanted.find((w: any) => w.initiative.id === featureStore);
    // Growth both asked and builds on it: still one team.
    expect(store.teams).toBe(2);
    expect(new Set(store.wants.map((w: any) => w.how))).toEqual(new Set(["asked", "builds_on"]));
    const library = data.wanted.find((w: any) => w.initiative.title === "Component library 3.0");
    const stale = library.wants.find((w: any) => w.stale);
    expect(stale).toMatchObject({
      how: "asked",
      reason: "Login pages should use the shared components",
    });
    expect(library.teams).toBe(2); // Payments and Growth build on it; Identity's old ask doesn't count
  });

  it("flags themes several teams started on separately", async () => {
    const { data } = await (await as("bob")).call("GET", "/reports/brief");
    const analytics = data.emerging.find((e: any) => e.tag === "analytics");
    expect(analytics).toMatchObject({ separate: true, count: 3 });
    expect(analytics.teamIds).toHaveLength(3);
    // "dashboards" only ever appears alongside "analytics", so it isn't its own theme.
    expect(data.emerging.some((e: any) => e.tag === "dashboards")).toBe(false);
  });

  it("says what changed in the period, naming merged duplicates", async () => {
    const { data } = await (await as("bob")).call("GET", "/reports/brief?days=30");
    const merge = data.changes.find((c: any) => c.kind === "merged");
    expect(merge.initiative.title).toBe("Dark theme for the marketing site");
    expect(merge.other.id).toBe(darkMode);
    const growth = (await sql`select id from teams where name = 'Growth'`)[0]!.id;
    const wanted = data.changes.filter(
      (c: any) => c.kind === "wanted" && c.initiative.id === featureStore && c.teamId === growth,
    );
    expect(wanted).toHaveLength(1);
    expect((await (await as("bob")).call("GET", "/reports/brief?days=0")).data.changes).toEqual([]);
  });

  it("scopes to an org unit", async () => {
    const bob = await as("bob");
    const all = (await bob.call("GET", "/reports/brief?days=0")).data;
    const unit = all.orgUnits[0];
    const scoped = (await bob.call("GET", `/reports/brief?days=0&unit=${encodeURIComponent(unit)}`))
      .data;
    expect(scoped.orgUnit).toBe(unit);
    expect(scoped.teams.every((t: any) => t.orgUnit === unit)).toBe(true);
    expect(scoped.totals.live).toBeLessThan(all.totals.live);
  });

  it("lists open duplicates strongest first, a limited number at a time", async () => {
    const bob = await as("bob");
    const all = await bob.call("GET", "/overlaps");
    expect(all.status).toBe(200);
    const scores = all.data.map((o: any) => o.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const one = await bob.call("GET", "/overlaps?limit=1");
    expect(one.data.length).toBeLessThanOrEqual(1);
    expect((await bob.call("GET", "/overlaps?limit=0")).status).toBe(400);
  });

  it("lists every open overlap of given initiatives, and counts them all", async () => {
    const bob = await as("bob");
    const a = await initiativeId("Customer analytics dashboards for account managers");
    const mine = await bob.call("GET", `/overlaps?initiativeIds=${a}`);
    expect(mine.status).toBe(200);
    expect(mine.data.length).toBeGreaterThan(0);
    expect(mine.data.every((o: any) => o.initiativeAId === a || o.initiativeBId === a)).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from initiative_overlaps where status = 'open'`;
    expect((await bob.call("GET", "/overlaps/count")).data).toEqual({ open: n });
    expect((await bob.call("GET", "/overlaps?initiativeIds=nope")).status).toBe(400);
  });

  it("notices a deleted initiative straight away, cache or not", async () => {
    const alice = await as("alice");
    const before = (await alice.call("GET", "/reports/brief?days=0")).data.totals.live;
    // Not the most recently updated one, so only the count can tell.
    const [{ id }] = await sql<{ id: string }[]>`
      select id from initiatives where merged_into_id is null and status <> 'cancelled'
        and title not like '%analytics dashboards%'
      order by updated_at asc limit 1`;
    expect((await alice.call("DELETE", `/initiatives/${id}`)).status).toBeLessThan(300);
    const after = (await alice.call("GET", "/reports/brief?days=0")).data.totals.live;
    expect(after).toBe(before - 1);
  });

  it("only accepts the offered periods", async () => {
    expect((await (await as("bob")).call("GET", "/reports/brief?days=7")).status).toBe(400);
  });

  it("leaves merged duplicates out", async () => {
    const alice = await as("alice");
    const before = (await alice.call("GET", "/reports/brief?days=0")).data.totals.live;
    const a = await initiativeId("Customer analytics dashboards for account managers");
    const b = await initiativeId("Self-serve customer analytics dashboards");
    expect((await alice.call("POST", `/initiatives/${a}/merge`, { intoId: b })).status).toBe(201);
    const after = (await alice.call("GET", "/reports/brief?days=0")).data;
    expect(after.totals.live).toBe(before - 1);
    expect(after.overlaps).toHaveLength(0);
  });
});

describe("written summary", () => {
  it("is grounded in the brief: every point cites initiatives from it", async () => {
    const bob = await as("bob");
    const brief = (await bob.call("GET", "/reports/brief")).data;
    const { status, data } = await bob.call("POST", "/reports/brief/summary", { days: 90 });
    expect(status).toBe(201);
    // The duplicate was merged above, so the most wanted work leads.
    expect(data.headline).toMatch(/"Dark mode everywhere" is wanted by 2 teams/);
    expect(data.points.length).toBeGreaterThan(0);
    const known = JSON.stringify(brief);
    for (const p of data.points) {
      expect(p.initiativeIds.length).toBeGreaterThan(0);
      for (const id of p.initiativeIds) expect(known).toContain(id);
    }
  });

  it("explains itself when no model is connected", async () => {
    const alice = await as("alice");
    await alice.call("DELETE", "/admin/llm");
    const r = await (await as("bob")).call("POST", "/reports/brief/summary", {});
    expect(r.status).toBe(503);
    expect(r.data.message).toMatch(/isn't set up/);
    await connectDemoLlm();
  });
});
