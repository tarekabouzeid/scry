import { beforeAll, describe, expect, it } from "vitest";
import { as, connectDemoLlm, initiativeId, resetDemo, sql } from "../support/scry";

let featureStore: string;
let growthDashboards: string;
let dataDashboards: string;
let components: string;

beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
  featureStore = await initiativeId("Feature store");
  components = await initiativeId("Component library 3.0");
  growthDashboards = await initiativeId("Customer analytics dashboards for account managers");
  dataDashboards = await initiativeId("Self-serve customer analytics dashboards");
});

describe("we need this too", () => {
  it("shows the seeded demand", async () => {
    const r = await (await as("bob")).call("GET", `/initiatives/${featureStore}/signals`);
    expect(new Set(r.data.map((s: any) => s.team.name))).toEqual(
      new Set(["Payments Platform", "Growth"]),
    );
  });

  it("is for other teams only, and needs a reason", async () => {
    const needed = { note: "We need it too" };
    const own = await (
      await as("priya")
    ).call("POST", `/initiatives/${featureStore}/signals`, needed);
    expect(own.status).toBe(400);
    expect(own.data.message).toBe("It's your own team's initiative");
    expect(
      (await (await as("carol")).call("POST", `/initiatives/${featureStore}/signals`, needed))
        .status,
    ).toBe(400);
    const bare = await (await as("omar")).call("POST", `/initiatives/${featureStore}/signals`, {});
    expect(bare.status).toBe(400);
  });

  it("fades when not confirmed for months, and saying it again confirms it", async () => {
    const components = await initiativeId("Component library 3.0");
    const omar = await as("omar");
    const before = (await omar.call("GET", `/initiatives/${components}/signals`)).data;
    expect(before.find((s: any) => s.user.name === "Omar Haddad").stale).toBe(true);
    const after = (
      await omar.call("POST", `/initiatives/${components}/signals`, {
        note: "Login pages should use the shared components",
      })
    ).data;
    expect(after.find((s: any) => s.user.name === "Omar Haddad").stale).toBe(false);
  });

  it("adds, updates the note without duplicating, notifies once, and withdraws", async () => {
    const omar = await as("omar");
    expect(
      (await omar.call("POST", `/initiatives/${featureStore}/signals`, { note: "ATO scoring too" }))
        .data,
    ).toHaveLength(3);
    const updated = await omar.call("POST", `/initiatives/${featureStore}/signals`, {
      note: "Updated",
    });
    expect(updated.data).toHaveLength(3);
    expect(updated.data.some((s: any) => s.note === "Updated")).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications n join users u on u.id = n.actor_id
      where n.kind = 'signal_added' and u.name = 'Omar Haddad'`;
    expect(n).toBe(1);
    const list = (await omar.call("GET", `/initiatives/lookup?ids=${featureStore}`)).data;
    expect(list.find((i: any) => i.id === featureStore).signalTeams).toBe(3);
    expect((await omar.call("DELETE", `/initiatives/${featureStore}/signals`)).data).toHaveLength(
      2,
    );
  });
});

describe("merging a duplicate", () => {
  it("is for the duplicate's owners", async () => {
    const r = await (
      await as("priya")
    ).call("POST", `/initiatives/${growthDashboards}/merge`, { intoId: dataDashboards });
    expect(r.status).toBe(403);
  });

  it("is only for a flagged duplicate", async () => {
    const r = await (
      await as("bob")
    ).call("POST", `/initiatives/${growthDashboards}/merge`, { intoId: components });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/flagged duplicate/);
  });

  it("closes a waiting request when the pair is marked not a duplicate", async () => {
    const bob = await as("bob");
    const asked = await bob.call("POST", `/initiatives/${growthDashboards}/merge`, {
      intoId: dataDashboards,
    });
    expect(asked.data.outcome).toBe("requested");
    const [overlap] = await sql<{ id: string }[]>`
      select id from initiative_overlaps
      where ${growthDashboards} in (initiative_a_id, initiative_b_id)
        and ${dataDashboards} in (initiative_a_id, initiative_b_id)`;
    const priya = await as("priya");
    expect(
      (await priya.call("PATCH", `/overlaps/${overlap!.id}`, { status: "dismissed" })).status,
    ).toBeLessThan(300);
    expect(
      (await bob.call("GET", `/initiatives/${growthDashboards}/merge-requests`)).data,
    ).toHaveLength(0);
    const told = await sql`
      select 1 from notifications n join users u on u.id = n.user_id
      where n.kind = 'merge_update' and u.name = 'Bob Martinez' and n.text like '%not a duplicate%'`;
    expect(told).toHaveLength(1);
    // Flag it again for the rest of this suite.
    await priya.call("PATCH", `/overlaps/${overlap!.id}`, { status: "open" });
    await sql`delete from notifications`;
  });

  it("asks the other team first when you can't edit their initiative", async () => {
    const bob = await as("bob");
    const priya = await as("priya");
    const asked = await bob.call("POST", `/initiatives/${growthDashboards}/merge`, {
      intoId: dataDashboards,
    });
    expect(asked.status).toBe(201);
    expect(asked.data).toMatchObject({
      outcome: "requested",
      request: {
        status: "pending",
        source: { id: growthDashboards, teamName: "Growth" },
        target: { id: dataDashboards, teamName: "Data & ML" },
        requestedBy: { name: "Bob Martinez" },
        canDecide: false,
        canWithdraw: true,
      },
    });
    const id = asked.data.request.id;
    // Nothing merged yet.
    const [source] = await sql<{ merged_into_id: string | null }[]>`
      select merged_into_id from initiatives where id = ${growthDashboards}`;
    expect(source!.merged_into_id).toBeNull();
    // Priya (owner, and Data & ML's team admin) is asked, and can decide.
    const [ask] = await sql<{ name: string; initiative_id: string }[]>`
      select u.name, n.initiative_id from notifications n join users u on u.id = n.user_id
      where n.kind = 'merge_request'`;
    expect(ask).toEqual({ name: "Priya Shah", initiative_id: dataDashboards });
    const seen = (await priya.call("GET", `/initiatives/${dataDashboards}/merge-requests`)).data;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id, canDecide: true, canWithdraw: false });

    // One open request per duplicate; bob can't accept his own.
    expect(
      (await bob.call("POST", `/initiatives/${growthDashboards}/merge`, { intoId: dataDashboards }))
        .status,
    ).toBe(409);
    expect((await bob.call("POST", `/merge-requests/${id}/approve`)).status).toBe(403);

    // Declined: bob hears back, and the duplicate stays as it was.
    expect((await priya.call("POST", `/merge-requests/${id}/decline`)).status).toBe(204);
    const [answer] = await sql<{ name: string; text: string }[]>`
      select u.name, n.text from notifications n join users u on u.id = n.user_id
      where n.kind = 'merge_update'`;
    expect(answer).toMatchObject({ name: "Bob Martinez" });
    expect(answer!.text).toMatch(/declined/);
    expect((await priya.call("POST", `/merge-requests/${id}/approve`)).status).toBe(409);

    // Asked again and withdrawn: priya hears that too.
    const again = await bob.call("POST", `/initiatives/${growthDashboards}/merge`, {
      intoId: dataDashboards,
    });
    expect(
      (await bob.call("POST", `/merge-requests/${again.data.request.id}/withdraw`)).status,
    ).toBe(204);
    const withdrawn = await sql`
      select 1 from notifications n join users u on u.id = n.user_id
      where n.kind = 'merge_update' and u.name = 'Priya Shah' and n.text like '%withdrew%'`;
    expect(withdrawn).toHaveLength(1);
    expect(
      (await priya.call("GET", `/initiatives/${dataDashboards}/merge-requests`)).data,
    ).toHaveLength(0);
  });

  it("folds it in: relationships, demand and discussion survive", async () => {
    const bob = await as("bob");
    await bob.call("POST", `/initiatives/${growthDashboards}/comments`, {
      body: "Folding this into Priya's.",
    });
    expect(
      (
        await bob.call("POST", "/edges", {
          fromInitiativeId: growthDashboards,
          toInitiativeId: components,
          type: "builds_on",
        })
      ).status,
    ).toBe(201);

    // Priya's work would change too, so bob only asks; she accepts.
    const asked = await bob.call("POST", `/initiatives/${growthDashboards}/merge`, {
      intoId: dataDashboards,
    });
    expect(asked.data.outcome).toBe("requested");
    const merged = await (
      await as("priya")
    ).call("POST", `/merge-requests/${asked.data.request.id}/approve`);
    expect(merged.status).toBe(201);
    expect(merged.data.id).toBe(dataDashboards);

    const [source] = await sql<{ status: string; merged_into_id: string }[]>`
      select status, merged_into_id from initiatives where id = ${growthDashboards}`;
    expect(source).toEqual({ status: "cancelled", merged_into_id: dataDashboards });
    const moved =
      await sql`select 1 from edges where from_initiative_id = ${dataDashboards} and to_initiative_id = ${components}`;
    expect(moved).toHaveLength(1);
    const left =
      await sql`select 1 from edges where ${growthDashboards} in (from_initiative_id, to_initiative_id)`;
    expect(left).toHaveLength(0);
    const signals = (await bob.call("GET", `/initiatives/${dataDashboards}/signals`)).data;
    expect(signals.some((s: any) => s.team.name === "Growth" && /Merged from/.test(s.note))).toBe(
      true,
    );
    const [overlap] = await sql<{ status: string }[]>`
      select status from initiative_overlaps
      where ${growthDashboards} in (initiative_a_id, initiative_b_id) and ${dataDashboards} in (initiative_a_id, initiative_b_id)`;
    expect(overlap!.status).toBe("merged");
    expect(
      (await bob.call("GET", `/initiatives/${growthDashboards}/comments`)).data.length,
    ).toBeGreaterThan(0);
    const history = (await bob.call("GET", `/initiatives/${dataDashboards}/activity`)).data;
    expect(history.some((a: any) => a.kind === "merged_from")).toBe(true);
    // Both sides hear about it; the one who accepted doesn't notify herself.
    const notified = await sql<{ name: string; text: string }[]>`
      select u.name, n.text from notifications n join users u on u.id = n.user_id
      where n.kind = 'merged' and n.initiative_id = ${growthDashboards}`;
    expect(notified.map((r) => r.name)).toContain("Bob Martinez");
    expect(notified[0]!.text).toMatch(/Priya Shah accepted Bob Martinez's request/);
  });

  it("can't be repeated, and the duplicate takes no new signals", async () => {
    const bob = await as("bob");
    expect(
      (await bob.call("POST", `/initiatives/${growthDashboards}/merge`, { intoId: dataDashboards }))
        .status,
    ).toBe(409);
    const r = await (
      await as("lena")
    ).call("POST", `/initiatives/${growthDashboards}/signals`, { note: "Design needs it too" });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/merged/);
  });

  it("merges at once for an admin, and tells both teams' admins", async () => {
    const refund = await initiativeId("Refund automation"); // Payments Platform
    const tokens = await initiativeId("Design tokens"); // Design Systems
    // Only a flagged duplicate can be merged, even by an admin.
    const alice = await as("alice");
    expect(
      (await alice.call("POST", `/initiatives/${refund}/merge`, { intoId: tokens })).status,
    ).toBe(400);
    const [a, b] = [refund, tokens].sort();
    await sql`insert into initiative_overlaps (initiative_a_id, initiative_b_id, score)
      values (${a!}, ${b!}, 0.9)`;
    const r = await (
      await as("alice")
    ).call("POST", `/initiatives/${refund}/merge`, { intoId: tokens });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ outcome: "merged", initiative: { id: tokens } });
    const told = await sql<{ name: string }[]>`
      select distinct u.name from notifications n join users u on u.id = n.user_id
      where n.kind = 'merged' and n.initiative_id in (${refund}, ${tokens})`;
    expect(told.map((t) => t.name)).toEqual(expect.arrayContaining(["Daniel Kim", "Lena Vogel"]));
  });

  it("leaves no relationships on the duplicate, and is audited", async () => {
    const rows = await sql`
      select count(*)::int as n from edges
      where from_initiative_id = ${growthDashboards} or to_initiative_id = ${growthDashboards}`;
    expect(rows[0]!.n).toBe(0);
    const audit = (await (await as("alice")).call("GET", "/admin/audit?action=initiatives.merged"))
      .data;
    // The demo's history already has one merge (Growth's dark theme).
    expect(audit.filter((a: any) => a.targetId === dataDashboards)).toHaveLength(1);
  });
});

describe("following tags", () => {
  it("lists the tags in use, most used first", async () => {
    const r = await (await as("bob")).call("GET", "/initiatives/tags");
    expect(r.status).toBe(200);
    expect(r.data.find((t: any) => t.tag === "analytics")?.count).toBeGreaterThan(1);
    const counts = r.data.map((t: any) => t.count);
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a));
  });

  it("only follows tags some initiative uses", async () => {
    const bob = await as("bob");
    const typo = await bob.call("POST", "/me/subscriptions", {
      targetType: "tag",
      targetValue: "analitycs",
    });
    expect(typo.status).toBe(400);
    expect(typo.data.message).toBe("No initiative is tagged #analitycs");
    const ok = await bob.call("POST", "/me/subscriptions", {
      targetType: "tag",
      targetValue: "Analytics",
    });
    expect(ok.status).toBe(201);
    expect(ok.data.targetValue).toBe("analytics");
    await bob.call("DELETE", `/me/subscriptions/${ok.data.id}`);
  });
});
