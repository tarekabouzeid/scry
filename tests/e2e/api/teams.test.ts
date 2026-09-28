import { beforeAll, describe, expect, it } from "vitest";
import { as, initiativeId, resetDemo, sql, userRow } from "../support/scry";

let teams: Record<string, string>;

beforeAll(async () => {
  await resetDemo();
  const rows = await sql<{ id: string; name: string }[]>`select id, name from teams`;
  teams = Object.fromEntries(rows.map((t) => [t.name, t.id]));
});

describe("joining a team", () => {
  it("is a request its team admin decides; until then it's look, don't touch", async () => {
    const carol = await as("carol");
    const asked = await carol.call("POST", "/onboarding/join", { teamId: teams.Growth });
    expect(asked.status).toBe(201);
    expect(asked.data).toMatchObject({ hasTeam: false, pending: { kind: "join" } });

    // Read-only while waiting.
    expect((await carol.call("GET", "/initiatives")).status).toBe(200);
    expect((await carol.call("POST", "/initiatives", { title: "t", summary: "s" })).status).toBe(
      403,
    );
    const referral = await initiativeId("Referral program v2");
    expect(
      (await carol.call("POST", `/initiatives/${referral}/comments`, { body: "hi" })).status,
    ).toBe(403);
    // One thing at a time.
    expect(
      (await carol.call("POST", "/onboarding/join", { teamId: teams["Data & ML"] })).status,
    ).toBe(409);

    // Growth's team admin hears about it.
    const bobInbox = (await (await as("bob")).call("GET", "/me/notifications")).data.items;
    expect(bobInbox[0]).toMatchObject({
      kind: "team_request",
      text: "Carol Nguyen asked to join Growth",
      initiativeId: null,
    });

    // Other teams' admins can't decide it; Growth's can.
    const [request] = (await (await as("bob")).call("GET", `/teams/${teams.Growth}/requests`)).data;
    expect(request.user.name).toBe("Carol Nguyen");
    expect(
      (
        await (
          await as("priya")
        ).call("POST", `/teams/${teams.Growth}/requests/${request.id}/approve`)
      ).status,
    ).toBe(403);
    expect(
      (
        await (
          await as("bob")
        ).call("POST", `/teams/${teams.Growth}/requests/${request.id}/approve`)
      ).status,
    ).toBe(201);
    expect((await carol.call("GET", "/onboarding/status")).data).toMatchObject({
      hasTeam: true,
      team: { name: "Growth" },
      pending: null,
    });
    expect((await carol.call("GET", "/auth/me")).data.teamAdmin).toBe(false);
    // …and Carol hears the answer.
    const carolInbox = (await carol.call("GET", "/me/notifications")).data.items;
    expect(carolInbox[0]).toMatchObject({
      kind: "team_update",
      text: "Bob Martinez let you into Growth",
    });
  });

  it("can be declined, and withdrawn", async () => {
    const priya = await as("priya");
    const [noah] = (await priya.call("GET", `/teams/${teams["Data & ML"]}/requests`)).data;
    expect(noah.user.name).toBe("Noah Fischer");
    await priya.call("POST", `/teams/${teams["Data & ML"]}/requests/${noah.id}/decline`);
    expect((await priya.call("GET", `/teams/${teams["Data & ML"]}/requests`)).data).toEqual([]);

    const noahSession = await as("noah");
    await noahSession.call("POST", "/onboarding/join", { teamId: teams.Growth });
    const withdrawn = await noahSession.call("DELETE", "/onboarding/pending");
    expect(withdrawn.data.pending).toBeNull();
  });
});

describe("creating a team", () => {
  it("uses the organisation's org units and countries", async () => {
    const r = await (
      await as("noah")
    ).call("POST", "/onboarding/create-team", { name: "X", orgUnit: "Sales", country: "DE" });
    expect(r.status).toBe(400);
    expect(r.data.message).toMatch(/isn't one of this organisation's org units/);
    const options = (await (await as("noah")).call("GET", "/teams/options")).data;
    expect(options.orgUnits).toContain("Engineering");
    expect(options.countries).toContain("NL");
  });

  it("waits for an admin; its creator becomes its team admin", async () => {
    const pending = (await (await as("alice")).call("GET", "/teams?includePending=true")).data.find(
      (t: any) => t.status === "pending",
    );
    expect(pending.name).toBe("Customer Support Tools");
    // Not a team yet for anyone else.
    expect(
      (await (await as("bob")).call("GET", "/teams")).data.some((t: any) => t.id === pending.id),
    ).toBe(false);
    expect((await (await as("bob")).call("POST", `/teams/${pending.id}/approve`)).status).toBe(403);
    expect((await (await as("alice")).call("POST", `/teams/${pending.id}/approve`)).status).toBe(
      201,
    );
    const mia = await as("mia");
    expect((await mia.call("GET", "/auth/me")).data).toMatchObject({
      teamId: pending.id,
      teamAdmin: true,
    });
    expect((await mia.call("GET", "/me/notifications")).data.items[0].text).toBe(
      "Customer Support Tools was approved. You're its team admin.",
    );
  });
});

describe("team admins", () => {
  it("edit their team's work, but not other teams'", async () => {
    const bob = await as("bob");
    const email = await initiativeId("Lifecycle email revamp"); // Growth, Bob's
    const pricing = await initiativeId("Pricing page experiments"); // Growth, Sam's contact
    const ledger = await initiativeId("Event-driven payments ledger"); // Payments
    expect((await bob.call("PATCH", `/initiatives/${pricing}`, { tier: "strategic" })).status).toBe(
      200,
    );
    expect((await bob.call("PATCH", `/initiatives/${ledger}`, { tier: "tactical" })).status).toBe(
      403,
    );
    // Sam isn't a team admin: Bob's own initiative is Bob's.
    expect(
      (await (await as("sam")).call("PATCH", `/initiatives/${email}`, { tier: "strategic" }))
        .status,
    ).toBe(403);
  });

  it("run their own team only: members, admin rights and its audit log", async () => {
    const bob = await as("bob");
    const sam = await userRow("sam");
    const bobRow = await userRow("bob");
    expect((await bob.call("GET", `/teams/${teams["Data & ML"]}/members`)).status).toBe(403);
    // The last team admin can't step down while others remain.
    expect(
      (
        await bob.call("PATCH", `/teams/${teams.Growth}/members/${bobRow.id}`, {
          teamAdmin: false,
        })
      ).status,
    ).toBe(409);
    await bob.call("PATCH", `/teams/${teams.Growth}/members/${sam.id}`, { teamAdmin: true });
    expect((await (await as("sam")).call("GET", "/auth/me")).data.teamAdmin).toBe(true);
    await bob.call("PATCH", `/teams/${teams.Growth}/members/${sam.id}`, { teamAdmin: false });
    expect((await bob.call("DELETE", `/teams/${teams.Growth}/members/${sam.id}`)).status).toBe(200);
    expect((await (await as("sam")).call("GET", "/auth/me")).data.teamId).toBeNull();

    const audit = (await bob.call("GET", `/teams/${teams.Growth}/audit`)).data;
    expect(audit.map((a: any) => a.action)).toEqual(
      expect.arrayContaining(["team.member_removed", "team.admin_granted", "team.member_approved"]),
    );
    expect(audit.every((a: any) => !a.summary.includes("Data & ML"))).toBe(true);
    // The full audit log stays admin-only.
    expect((await bob.call("GET", "/admin/audit")).status).toBe(403);
  });
});

describe("admins", () => {
  it("aren't in a team, and file work for its owner's team", async () => {
    const alice = await as("alice");
    expect((await alice.call("GET", "/auth/me")).data.teamId).toBeNull();
    const omar = await userRow("omar");
    const filed = await alice.call("POST", "/initiatives", {
      title: "Filed for Omar",
      summary: "An admin files work on someone's behalf.",
      teamId: teams["Identity & Security"],
      contactPerson: omar.id,
    });
    expect(filed.status).toBe(201);
    expect(filed.data.contactPerson).toBe(omar.id);
  });
});
