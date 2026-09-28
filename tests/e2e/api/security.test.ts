import { beforeAll, describe, expect, it } from "vitest";
import { as, initiativeId, resetDemo, sql, userRow } from "../support/scry";

let teams: Record<string, string>;

beforeAll(async () => {
  await resetDemo();
  const rows = await sql<{ id: string; name: string }[]>`select id, name from teams`;
  teams = Object.fromEntries(rows.map((t) => [t.name, t.id]));
});

describe("relationships", () => {
  it("need ownership of, or team membership on, at least one end", async () => {
    const bob = await as("bob");
    const ledger = await initiativeId("Event-driven payments ledger"); // Payments
    const tokens = await initiativeId("Design tokens"); // Design Systems
    const r = await bob.call("POST", "/edges", {
      fromInitiativeId: ledger,
      toInitiativeId: tokens,
      type: "builds_on",
    });
    expect(r.status).toBe(403);
  });

  it("can be added from your team's work and removed by the other end's team", async () => {
    const referral = await initiativeId("Referral program v2"); // Growth
    const churn = await initiativeId("Churn prediction model"); // Data & ML
    const created = await (
      await as("bob")
    ).call("POST", "/edges", {
      fromInitiativeId: referral,
      toInitiativeId: churn,
      type: "builds_on",
    });
    expect(created.status).toBe(201);
    const removed = await (await as("priya")).call("DELETE", `/edges/${created.data.id}`);
    expect([200, 204]).toContain(removed.status);
  });

  it("only connect different teams", async () => {
    const r = await (
      await as("bob")
    ).call("POST", "/edges", {
      fromInitiativeId: await initiativeId("Pricing page experiments"),
      toInitiativeId: await initiativeId("Referral program v2"),
      type: "related",
    });
    expect(r.status).toBe(400);
    expect(r.data.message).toBe("Both belong to Growth. Relationships connect different teams.");
  });

  it("allow one per pair, whichever way round", async () => {
    const priya = await as("priya");
    const churn = await initiativeId("Churn prediction model"); // Data & ML
    const email = await initiativeId("Lifecycle email revamp"); // Growth
    const first = await priya.call("POST", "/edges", {
      fromInitiativeId: churn,
      toInitiativeId: email,
      type: "related",
    });
    expect(first.status).toBe(201);
    // "related" is stored one way round, whichever end it was added from.
    expect([first.data.fromInitiativeId, first.data.toInitiativeId].sort()).toEqual(
      [churn, email].sort(),
    );
    const again = await priya.call("POST", "/edges", {
      fromInitiativeId: email,
      toInitiativeId: churn,
      type: "builds_on",
    });
    expect(again.status).toBe(409);
    await priya.call("DELETE", `/edges/${first.data.id}`);
  });
});

describe("initiative placement", () => {
  it("non-admins file only under their own team, with a contact from it", async () => {
    const bob = await as("bob");
    const omar = await userRow("omar");
    expect(
      (
        await bob.call("POST", "/initiatives", {
          title: "t",
          summary: "s",
          teamId: teams["Payments Platform"],
        })
      ).status,
    ).toBe(403);
    expect(
      (await bob.call("POST", "/initiatives", { title: "t", summary: "s", contactPerson: omar.id }))
        .status,
    ).toBe(400);
    const imported = await bob.call("POST", "/initiatives/import", {
      rows: [{ title: "t", summary: "s", teamId: teams["Payments Platform"] }],
    });
    expect(imported.data).toMatchObject({ created: 0 });
    expect(imported.data.errors).toHaveLength(1);
  });

  it("only admins move work between teams", async () => {
    const referral = await initiativeId("Referral program v2");
    const r = await (
      await as("bob")
    ).call("PATCH", `/initiatives/${referral}`, { teamId: teams["Payments Platform"] });
    expect(r.status).toBe(403);
    const bob = await userRow("bob");
    const admin = await (
      await as("alice")
    ).call("POST", "/initiatives", {
      title: "Filed by an admin",
      summary: "s",
      teamId: teams.Growth,
      contactPerson: bob.id,
    });
    expect(admin.status).toBe(201);
  });
});

describe("input limits", () => {
  it("rejects oversized chat messages and searches", async () => {
    const bob = await as("bob");
    const session = await bob.call("POST", "/chat/sessions");
    expect(
      (
        await bob.call("POST", `/chat/sessions/${session.data.id}/messages`, {
          content: "x".repeat(4001),
        })
      ).status,
    ).toBe(400);
    expect((await bob.call("GET", `/search?q=${"x".repeat(501)}`)).status).toBe(400);
    expect((await bob.call("GET", `/initiatives?search=${"x".repeat(201)}`)).status).toBe(400);
  });
});

describe("people directory", () => {
  it("non-admins see directory fields only; admins and yourself see everything", async () => {
    const bob = await as("bob");
    const list = await bob.call("GET", "/users");
    expect(Object.keys(list.data[0]).sort()).toEqual([
      "email",
      "id",
      "name",
      "teamAdmin",
      "teamId",
    ]);
    const alice = await userRow("alice");
    expect((await bob.call("GET", `/users/${alice.id}`)).data).not.toHaveProperty("role");
    expect((await bob.call("GET", `/users/${bob.user.id}`)).data.role).toBe("member");
    expect((await (await as("alice")).call("GET", "/users")).data[0]).toHaveProperty("role");
  });

  it("won't demote the last admin", async () => {
    const alice = await as("alice");
    expect((await alice.call("PATCH", `/users/${alice.user.id}`, { role: "member" })).status).toBe(
      409,
    );
  });
});

describe("rate limits", () => {
  it("limit search per caller, not per server", async () => {
    const carol = await as("carol");
    let limited = 0;
    for (let i = 0; i < 65; i++)
      if ((await carol.call("GET", "/search?q=x")).status === 429) limited++;
    expect(limited).toBeGreaterThanOrEqual(5);
    expect((await (await as("lena")).call("GET", "/search?q=x")).status).not.toBe(429);
  });
});
