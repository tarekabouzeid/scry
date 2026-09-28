import { beforeAll, describe, expect, it } from "vitest";
import { as, initiativeId, resetDemo, sql } from "../support/scry";

let featureStore: string;
let merchantRisk: string;
let email: string;
let passkeys: string;
let referral: string;

beforeAll(async () => {
  await resetDemo();
  featureStore = await initiativeId("Feature store"); // Data & ML
  merchantRisk = await initiativeId("Merchant fraud risk scoring"); // builds on it
  email = await initiativeId("Lifecycle email revamp"); // builds on it
  passkeys = await initiativeId("Passkeys for customer login"); // Identity & Security
  referral = await initiativeId("Referral program v2"); // builds on passkeys
});

describe("GET /edges", () => {
  it("needs the initiatives it's about", async () => {
    const bob = await as("bob");
    expect((await bob.call("GET", "/edges")).status).toBe(400);
    expect((await bob.call("GET", "/edges?initiativeIds=nope")).status).toBe(400);
  });

  it("returns the edges touching them", async () => {
    const r = await (await as("bob")).call("GET", `/edges?initiativeIds=${passkeys}`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual([
      expect.objectContaining({
        fromInitiativeId: referral,
        toInitiativeId: passkeys,
        type: "builds_on",
      }),
    ]);
  });
});

describe("GET /graph/neighbourhood", () => {
  it("returns an initiative, what's one step away, and the edges between them", async () => {
    const r = await (
      await as("bob")
    ).call("GET", `/graph/neighbourhood?initiativeId=${featureStore}`);
    expect(r.status).toBe(200);
    expect(r.data.truncated).toBe(false);
    expect(r.data.nodes[0].id).toBe(featureStore);
    const ids = r.data.nodes.map((n: { id: string }) => n.id);
    expect(ids).toEqual(expect.arrayContaining([featureStore, merchantRisk, email]));
    expect(r.data.nodes[0]).toHaveProperty("title", "Feature store");
    expect(r.data.nodes[0]).not.toHaveProperty("embedding");
    for (const edge of r.data.edges) {
      expect(ids).toContain(edge.fromInitiativeId);
      expect(ids).toContain(edge.toInitiativeId);
    }
    expect(r.data.edges.length).toBeGreaterThanOrEqual(2);
  });

  it("caps the nodes and says so", async () => {
    const r = await (
      await as("bob")
    ).call("GET", `/graph/neighbourhood?initiativeId=${featureStore}&limit=2`);
    expect(r.data.nodes).toHaveLength(2);
    expect(r.data.truncated).toBe(true);
  });

  it("shows a team's related work and what it connects to", async () => {
    const [team] = await sql<{ id: string }[]>`
      select id from teams where name = 'Identity & Security'`;
    const r = await (await as("bob")).call("GET", `/graph/neighbourhood?teamId=${team!.id}`);
    expect(r.status).toBe(200);
    const ids = r.data.nodes.map((n: { id: string }) => n.id);
    expect(ids).toEqual(expect.arrayContaining([passkeys, referral]));
  });

  it("refuses bad questions", async () => {
    const bob = await as("bob");
    const [team] = await sql<{ id: string }[]>`select id from teams limit 1`;
    expect((await bob.call("GET", "/graph/neighbourhood")).status).toBe(400);
    expect(
      (
        await bob.call(
          "GET",
          `/graph/neighbourhood?initiativeId=${featureStore}&teamId=${team!.id}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (await bob.call("GET", `/graph/neighbourhood?initiativeId=${featureStore}&hops=3`)).status,
    ).toBe(400);
    expect(
      (
        await bob.call(
          "GET",
          "/graph/neighbourhood?initiativeId=00000000-0000-4000-8000-000000000000",
        )
      ).status,
    ).toBe(404);
  });
});

describe("GET /graph/overview", () => {
  it("maps every team with work, and counts relationships between teams", async () => {
    const r = await (await as("bob")).call("GET", "/graph/overview");
    expect(r.status).toBe(200);
    expect(r.data.teamLimit).toBeGreaterThan(0);
    const [identity] = await sql<{ id: string }[]>`
      select id from teams where name = 'Identity & Security'`;
    const [growth] = await sql<{ id: string }[]>`select id from teams where name = 'Growth'`;
    const byId = new Map(r.data.teams.map((t: { id: string }) => [t.id, t]));
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from initiatives
      where team_id = ${identity!.id} and merged_into_id is null`;
    expect(byId.get(identity!.id)).toMatchObject({ name: "Identity & Security", total: n });
    // Teams without work (e.g. a new one waiting for approval) aren't drawn.
    for (const t of r.data.teams) expect(t.total).toBeGreaterThan(0);
    // Referral v2 (Growth) builds on Passkeys (Identity & Security).
    expect(r.data.links).toContainEqual(
      expect.objectContaining({
        fromTeamId: growth!.id,
        toTeamId: identity!.id,
        type: "builds_on",
      }),
    );
    for (const l of r.data.links) expect(l.fromTeamId).not.toBe(l.toTeamId);
  });
});

describe("GET /graph/teams/:id", () => {
  it("returns a team's work, related work first, and every relationship touching it", async () => {
    const [identity] = await sql<{ id: string }[]>`
      select id from teams where name = 'Identity & Security'`;
    const r = await (await as("bob")).call("GET", `/graph/teams/${identity!.id}`);
    expect(r.status).toBe(200);
    expect(r.data.teamId).toBe(identity!.id);
    const related = new Set(
      r.data.edges.flatMap((e: { fromInitiativeId: string; toInitiativeId: string }) => [
        e.fromInitiativeId,
        e.toInitiativeId,
      ]),
    );
    const order = r.data.nodes.map((n: { id: string }) => related.has(n.id));
    expect(order).toEqual([...order].sort((a, b) => Number(b) - Number(a)));
    expect(r.data.nodes).toContainEqual({
      id: passkeys,
      title: "Passkeys for customer login",
      status: expect.any(String),
      teamId: identity!.id,
    });
    expect(r.data.total).toBe(r.data.nodes.length);
    expect(r.data.edges).toContainEqual(
      expect.objectContaining({
        fromInitiativeId: referral,
        toInitiativeId: passkeys,
        toTeamId: identity!.id,
        type: "builds_on",
      }),
    );
  });

  it("refuses an unknown team", async () => {
    const bob = await as("bob");
    expect((await bob.call("GET", "/graph/teams/nope")).status).toBe(400);
    expect(
      (await bob.call("GET", "/graph/teams/00000000-0000-4000-8000-000000000000")).status,
    ).toBe(404);
  });
});
