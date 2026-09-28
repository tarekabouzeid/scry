import { beforeAll, expect, it } from "vitest";
import { as, connectDemoLlm, resetDemo, sql, userRow } from "../support/scry";

beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
});

it("records admin and security changes with readable summaries", async () => {
  const alice = await as("alice");
  const bob = await userRow("bob");
  await alice.call("PATCH", `/users/${bob.id}`, { role: "admin" });
  await alice.call("PATCH", `/users/${bob.id}`, { role: "member" });
  const [growth] = await sql<{ id: string }[]>`select id from teams where name = 'Growth'`;
  await alice.call("PATCH", `/teams/${growth!.id}`, { name: "Growth Team" });
  await alice.call("PATCH", `/teams/${growth!.id}`, { name: "Growth" });

  const view = (await alice.call("GET", "/admin/llm")).data;
  const settings = structuredClone(view.settings);
  settings.models.assistant.temperature = 0.2;
  await alice.call("PUT", "/admin/llm", {
    settings,
    secrets: { apiKey: "sk-should-never-appear" },
  });
  const token = await (await as("bob")).call("POST", "/auth/pat", { name: "laptop" });

  expect((await (await as("bob")).call("GET", "/admin/audit")).status).toBe(403);
  const log = (await alice.call("GET", "/admin/audit")).data as any[];
  const summaries = log.map((e) => e.summary);
  expect(summaries).toContain("Alice Chen changed Bob Martinez's role from member to admin");
  expect(summaries).toContain("Alice Chen renamed the team Growth to Growth Team");
  expect(summaries).toContain('Bob Martinez created a read-only API token "laptop"');
  const aiChange = log.find((e) => e.action === "ai.settings_saved" && e.data.changed?.length);
  expect(aiChange.data.changed).toContain("models.assistant.temperature");
  expect(aiChange.data.credentials).toContain("apiKey set");
  // Which credential changed — never its value; and never the token itself.
  expect(JSON.stringify(log)).not.toContain("sk-should-never-appear");
  expect(JSON.stringify(log)).not.toContain(token.data.token);
});

it("filters by action and pages exactly", async () => {
  const alice = await as("alice");
  const roles = (await alice.call("GET", "/admin/audit?action=user.role_changed")).data as any[];
  expect(roles).toHaveLength(3); // the two above, and one from the demo's history
  const all = (await alice.call("GET", "/admin/audit?limit=200")).data as any[];
  const seen: string[] = [];
  let cursor = "";
  for (;;) {
    const page = (await alice.call("GET", `/admin/audit?limit=2${cursor}`)).data as any[];
    seen.push(...page.map((e) => e.id));
    if (page.length < 2) break;
    const last = page[page.length - 1];
    cursor = `&before=${encodeURIComponent(`${last.createdAt}_${last.id}`)}`;
  }
  expect(seen).toEqual(all.map((e) => e.id));
});
