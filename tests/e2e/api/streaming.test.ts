import { beforeAll, expect, it } from "vitest";
import { env } from "../support/env";
import { as, connectDemoLlm, resetDemo } from "../support/scry";

beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
});

async function stream(token: string, sessionId: string, content: string) {
  const res = await fetch(`${env.apiUrl}/chat/sessions/${sessionId}/messages/stream`, {
    method: "POST",
    headers: { cookie: `scry_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const events: any[] = [];
  const firstAt: number[] = [];
  const started = Date.now();
  if (res.ok && res.body) {
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line) {
          events.push(JSON.parse(line));
          firstAt.push(Date.now() - started);
        }
      }
    }
  }
  return { res, events, firstAt };
}

it("streams the answer as it's written, then saves it", async () => {
  const bob = await as("bob");
  const session = await bob.call("POST", "/chat/sessions");
  const { res, events, firstAt } = await stream(
    bob.token,
    session.data.id,
    "Passwordless login for customers using passkeys",
  );
  expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
  // The agent searches first, and says so.
  expect(events[0]).toEqual({
    type: "tool",
    tool: "search_initiatives",
    query: "Passwordless login for customers using passkeys.",
  });
  const deltas = events.filter((e) => e.type === "delta");
  expect(deltas.length).toBeGreaterThan(5);
  const done = events.at(-1);
  expect(done.type).toBe("done");
  expect(done.classification).toBe("STRONG_MATCH");
  expect(deltas.map((d) => d.text).join("")).toBe(done.message.content);
  // The first words arrive well before the whole answer.
  expect(firstAt[1]!).toBeLessThan(firstAt.at(-1)!);
  const saved = (await bob.call("GET", `/chat/sessions/${session.data.id}`)).data.messages;
  expect(saved.map((m: any) => m.role)).toEqual(["user", "assistant"]);
});

it("the agent picks its tools: no search for small talk or follow-ups", async () => {
  const bob = await as("bob");
  const session = await bob.call("POST", "/chat/sessions");
  const id = session.data.id;
  const tools = (events: any[]) => events.filter((e) => e.type === "tool").map((e) => e.tool);

  const hi = (await stream(bob.token, id, "Hi")).events;
  expect(tools(hi)).toEqual([]);
  expect(hi.at(-1).message).toMatchObject({
    searchQuery: null,
    registerReady: false,
    evidence: [],
    classification: null,
  });
  expect(hi.at(-1).message.content).toMatch(/Describe your idea/);

  const idea = (await stream(bob.token, id, "Passwordless login for customers using passkeys"))
    .events;
  expect(tools(idea)).toEqual(["search_initiatives"]);
  // A likely duplicate: talk to the owners first, so no offer to register.
  expect(idea.at(-1).message).toMatchObject({
    searchQuery: "Passwordless login for customers using passkeys.",
    classification: "STRONG_MATCH",
    registerReady: false,
  });
  expect(idea.at(-1).message.evidence.map((e: any) => e.via)).toContain("semantic");

  // A question about what it found: looked up, not searched again.
  const who = (await stream(bob.token, id, "Who should I talk to?")).events;
  expect(tools(who)).toEqual(["get_initiative"]);
  expect(who.at(-1).message.searchQuery).toBeNull();
  expect(who.at(-1).message.content).toMatch(/Omar Haddad/);
  expect(who.at(-1).message.evidence).toHaveLength(1);

  // Asking to go ahead gets the Register button: it's the person's call.
  const goAhead = (await stream(bob.token, id, "nah, I just want to register it")).events;
  expect(tools(goAhead)).toEqual(["offer_registration"]);
  expect(goAhead.at(-1).message).toMatchObject({ searchQuery: null, registerReady: true });
  expect(goAhead.at(-1).message.content).toMatch(/Register/);

  const saved = (await bob.call("GET", `/chat/sessions/${id}`)).data;
  // Named after the idea, not the greeting.
  expect(saved.session.title).toBe("Passwordless login for customers using passkeys");
  expect(saved.messages).toHaveLength(8);
});

it("registering needs a search first, and isn't offered again once registered", async () => {
  const dan = await as("dan");
  const session = await dan.call("POST", "/chat/sessions");
  const id = session.data.id;
  // Nothing searched yet, so no Register button.
  const early = (await stream(dan.token, id, "Hi, I want to register something")).events;
  expect(early.at(-1).message.registerReady).toBe(false);

  const idea = (await stream(dan.token, id, "Carbon footprint reporting for business customers"))
    .events;
  expect(idea.at(-1).message).toMatchObject({ classification: "NO_MATCH", registerReady: true });
  const created = await dan.call("POST", `/chat/sessions/${id}/register`, {
    title: "Carbon footprint reporting",
    summary: "Carbon footprint reports for business customers.",
    status: "idea",
    tier: "tactical",
    tags: [],
  });
  expect(created.status).toBe(201);

  // Registered: the agent knows, won't offer again, and doesn't find the idea itself.
  const again = (await stream(dan.token, id, "ok, register it")).events;
  expect(again.at(-1).message.registerReady).toBe(false);
  expect(again.at(-1).message.content).toMatch(
    /already registered as \*\*Carbon footprint reporting\*\*/,
  );
  const changed = (await stream(dan.token, id, "Carbon footprint reporting for suppliers too"))
    .events;
  expect(changed.at(-1).candidates.map((c: any) => c.id)).not.toContain(created.data.id);
});

it("errors before the stream are plain HTTP errors", async () => {
  const bob = await as("bob");
  const { res } = await stream(bob.token, "00000000-0000-4000-8000-000000000000", "hello");
  expect(res.status).toBe(404);
});

it("every model call shows up in the usage stats", async () => {
  const usage = (await (await as("alice")).call("GET", "/admin/llm/usage?hours=24")).data;
  const assistant = usage.roles.find((r: any) => r.role === "assistant");
  const embedding = usage.roles.find((r: any) => r.role === "embedding");
  expect(assistant.calls).toBeGreaterThanOrEqual(1);
  // Indexing embeds up to 50 initiatives per request, so the 22 demo ones
  // are one call; the searches above add their own.
  expect(embedding.calls).toBeGreaterThanOrEqual(2);
  expect(usage.series.length).toBeGreaterThan(0);
});
