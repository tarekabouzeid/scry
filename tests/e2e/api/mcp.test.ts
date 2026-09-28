import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { as, connectDemoLlm, initiativeId, resetDemo, sql, waitFor } from "../support/scry";
import { env } from "../support/env";

const MCP = `${env.apiUrl}/mcp`;
let passkeys: string;
let referral: string;
let readToken: string;

/** One JSON-RPC call to /mcp with a bearer credential. */
async function rpc(
  bearer: string | null,
  method: string,
  params?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
}

async function tool(bearer: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(bearer, "tools/call", { name, arguments: args });
  expect(r.status).toBe(200);
  return r.data.result as { isError: boolean; structuredContent?: any; content: any[] };
}

beforeAll(async () => {
  await resetDemo();
  passkeys = await initiativeId("Passkeys for customer login");
  referral = await initiativeId("Referral program v2");
});

describe("personal access tokens", () => {
  it("are read-only unless asked for write", async () => {
    const bob = await as("bob");
    const read = await bob.call("POST", "/auth/pat", { name: "agent" });
    readToken = read.data.token;
    const write = (await bob.call("POST", "/auth/pat", { name: "import", scope: "write" })).data
      .token;
    const listed = (await bob.call("GET", "/auth/pat")).data;
    expect(listed.find((t: any) => t.name === "agent").scope).toBe("read");

    const get = await fetch(`${env.apiUrl}/initiatives?limit=1`, {
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(get.status).toBe(200);
    const post = (bearer: string) =>
      fetch(`${env.apiUrl}/auth/me/tour-seen`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}` },
      });
    const refused = await post(readToken);
    expect(refused.status).toBe(403);
    expect((await refused.json()).message).toMatch(/read-only/);
    expect((await post(write)).status).toBe(204);
  });
});

describe("the MCP endpoint", () => {
  it("wants a credential, and says where to get one", async () => {
    const r = await rpc(null, "initialize");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(
      `resource_metadata="${env.apiUrl}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect((await rpc("nope", "initialize")).headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });

  it("is off until an admin turns it on", async () => {
    expect((await rpc(readToken, "tools/list")).status).toBe(403);
    expect((await (await as("bob")).call("PUT", "/admin/mcp", { enabled: true })).status).toBe(403);
    const alice = await as("alice");
    expect((await alice.call("PUT", "/admin/mcp", { enabled: true })).data).toEqual({
      enabled: true,
    });
    const [entry] = await sql`select 1 from audit_log where action = 'mcp.enabled'`;
    expect(entry).toBeDefined();
  });

  it("speaks MCP: initialize, list tools, notifications, only POST", async () => {
    const init = await rpc(readToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.data.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "scry" },
      capabilities: { tools: {} },
    });
    const tools = (await rpc(readToken, "tools/list")).data.result.tools;
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      "check_idea",
      "get_initiative",
      "list_initiatives",
      "list_teams",
      "portfolio_brief",
      "search_initiatives",
    ]);
    const note = await fetch(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${readToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.status).toBe(202);
    expect((await fetch(MCP, { headers: { authorization: `Bearer ${readToken}` } })).status).toBe(
      405,
    );
    expect((await rpc(readToken, "ping", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect(
      (await rpc(readToken, "ping", {}, { "mcp-protocol-version": "1999-01-01" })).status,
    ).toBe(400);
  });

  it("answers from the register, with links, and works without AI", async () => {
    const search = await tool(readToken, "search_initiatives", { query: "passkeys" });
    expect(search.isError).toBe(false);
    expect(search.structuredContent.mode).toBe("keywords");
    const hit = search.structuredContent.results.find((r: any) => r.id === passkeys);
    expect(hit).toMatchObject({ team: "Identity & Security", url: `${env.webUrl}/?i=${passkeys}` });

    const one = (await tool(readToken, "get_initiative", { id: passkeys })).structuredContent;
    expect(one.contact).toMatchObject({ name: "Omar Haddad" });
    expect(one.relationships).toContainEqual(
      expect.objectContaining({
        type: "builds_on",
        other: expect.objectContaining({ id: referral }),
      }),
    );

    const onHold = (
      await tool(readToken, "list_initiatives", { team: "growth", status: "on_hold" })
    ).structuredContent.results;
    expect(onHold.map((r: any) => r.title)).toContain("Referral program v2");
    const teams = (await tool(readToken, "list_teams")).structuredContent.teams;
    expect(teams.find((t: any) => t.name === "Growth").initiatives).toBeGreaterThan(0);
    const brief = (await tool(readToken, "portfolio_brief", { days: 90 })).structuredContent;
    expect(brief.totals.live).toBeGreaterThan(0);

    const noAi = await tool(readToken, "check_idea", {
      description: "Passwordless login for customers with passkeys",
    });
    expect(noAi.isError).toBe(true);
    expect(noAi.content[0].text).toMatch(/needs an AI model/);
    const badTeam = await tool(readToken, "list_initiatives", { team: "Marketing" });
    expect(badTeam.isError).toBe(true);
    expect(badTeam.content[0].text).toMatch(/Teams: .*Growth/);
  });

  it("searches by meaning once AI is connected", async () => {
    await connectDemoLlm();
    const search = await tool(readToken, "search_initiatives", { query: "passkeys login" });
    expect(search.structuredContent.mode).toBe("semantic");
    expect(search.structuredContent.results.map((r: any) => r.id)).toContain(passkeys);
    const idea = await tool(readToken, "check_idea", {
      description: "Passkeys for customer login, so customers stop using passwords",
    });
    expect(idea.isError).toBe(false);
    expect(idea.structuredContent.matches.map((m: any) => m.id)).toContain(passkeys);
  });

  it("logs every call for admins", async () => {
    const alice = await as("alice");
    await waitFor(async () => {
      const rows = await sql`select 1 from mcp_calls where tool = 'check_idea' and ok`;
      return rows.length > 0;
    }, "the calls to be logged");
    const settings = (await alice.call("GET", "/admin/mcp")).data;
    expect(settings).toMatchObject({ enabled: true, url: MCP, retentionDays: 90 });
    const bob = settings.people.find((p: any) => p.user.name === "Bob Martinez");
    expect(bob.clients).toContain("agent");
    const calls = (await alice.call("GET", `/admin/mcp/calls?userId=${bob.user.id}`)).data;
    const getCall = calls.find((c: any) => c.tool === "get_initiative");
    expect(getCall).toMatchObject({ via: "token", ok: true, input: { id: passkeys } });
    expect(getCall.resultIds).toContain(passkeys);
    expect(calls.some((c: any) => c.tool === "check_idea" && !c.ok)).toBe(true);
    expect((await (await as("bob")).call("GET", "/admin/mcp/calls")).status).toBe(403);
  });
});

describe("signing in an AI tool with OAuth", () => {
  const redirectUri = "http://localhost:8765/callback";
  let clientId: string;

  const pkce = () => {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
  };
  const authorizeUrl = (params: Record<string, string>) =>
    `${env.apiUrl}/oauth/authorize?${new URLSearchParams(params)}`;
  const token = async (params: Record<string, string>) => {
    const res = await fetch(`${env.apiUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    return { status: res.status, data: await res.json() };
  };
  /** The whole dance as bob, up to the code. */
  const authorize = async (challenge: string) => {
    const start = await fetch(
      authorizeUrl({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "xyz",
        scope: "scry:read",
        resource: MCP,
      }),
      { redirect: "manual" },
    );
    expect(start.status).toBe(302);
    const consent = new URL(start.headers.get("location")!);
    expect(consent.origin + consent.pathname).toBe(`${env.webUrl}/connect`);
    const request = consent.searchParams.get("request")!;
    const bob = await as("bob");
    expect((await bob.call("GET", `/oauth/request?request=${request}`)).data).toMatchObject({
      clientName: "Test agent",
      returnsTo: "localhost:8765",
      enabled: true,
    });
    const decision = await bob.call("POST", "/oauth/decision", { request, allow: true });
    const back = new URL(decision.data.redirect);
    expect(back.origin + back.pathname).toBe(redirectUri);
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.get("iss")).toBe(env.apiUrl);
    return back.searchParams.get("code")!;
  };

  it("publishes its metadata", async () => {
    const resource = await (
      await fetch(`${env.apiUrl}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    expect(resource).toMatchObject({ resource: MCP, authorization_servers: [env.apiUrl] });
    const server = await (
      await fetch(`${env.apiUrl}/.well-known/oauth-authorization-server`)
    ).json();
    expect(server).toMatchObject({
      issuer: env.apiUrl,
      code_challenge_methods_supported: ["S256"],
      registration_endpoint: `${env.apiUrl}/oauth/register`,
    });
  });

  it("registers public clients with safe redirects only", async () => {
    const bad = await fetch(`${env.apiUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Evil", redirect_uris: ["http://evil.example/cb"] }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_redirect_uri");
    const ok = await fetch(`${env.apiUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Test agent", redirect_uris: [redirectUri] }),
    });
    expect(ok.status).toBe(201);
    clientId = (await ok.json()).client_id;
    expect(clientId).toMatch(/^scry_client_/);
  });

  it("refuses bad authorization requests", async () => {
    const unknown = await fetch(
      authorizeUrl({ response_type: "code", client_id: "nope", redirect_uri: redirectUri }),
      { redirect: "manual" },
    );
    expect(unknown.status).toBe(400);
    const noPkce = await fetch(
      authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: redirectUri }),
      { redirect: "manual" },
    );
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe(
      "invalid_request",
    );
  });

  it("issues a read-only token for /mcp only, with rotating refresh", async () => {
    const { verifier, challenge } = pkce();
    const code = await authorize(challenge);
    const wrong = await token({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: "x".repeat(43),
    });
    expect(wrong.data.error).toBe("invalid_grant");
    // The code was spent by that failed attempt: start again.
    const second = pkce();
    const code2 = await authorize(second.challenge);
    const issued = await token({
      grant_type: "authorization_code",
      code: code2,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: second.verifier,
    });
    expect(issued.status).toBe(200);
    expect(issued.data).toMatchObject({ token_type: "Bearer", scope: "scry:read" });
    const reused = await token({
      grant_type: "authorization_code",
      code: code2,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: second.verifier,
    });
    expect(reused.data.error).toBe("invalid_grant");
    void verifier;

    const access = issued.data.access_token;
    expect((await rpc(access, "tools/list")).status).toBe(200);
    // Bound to /mcp: the REST api doesn't take it.
    const me = await fetch(`${env.apiUrl}/auth/me`, {
      headers: { authorization: `Bearer ${access}` },
    });
    expect(me.status).toBe(401);

    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: issued.data.refresh_token,
      client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
    const replay = await token({
      grant_type: "refresh_token",
      refresh_token: issued.data.refresh_token,
      client_id: clientId,
    });
    expect(replay.data.error).toBe("invalid_grant");

    await tool(refreshed.data.access_token, "list_teams");
    // The log is written after the answer (it never slows a call down).
    await waitFor(async () => {
      const rows = await sql`select 1 from mcp_calls where via = 'oauth' and client = 'Test agent'`;
      return rows.length > 0;
    }, "the OAuth call to be logged");

    // Bob sees it in Settings and disconnects it: its tokens stop at once.
    const bob = await as("bob");
    const mine = (await bob.call("GET", "/mcp-connections")).data;
    expect(mine).toMatchObject({ enabled: true, url: MCP });
    const connection = mine.connections.find((c: any) => c.client === "Test agent");
    expect(connection).toBeDefined();
    expect((await bob.call("DELETE", `/mcp-connections/${connection.id}`)).status).toBe(204);
    expect((await rpc(refreshed.data.access_token, "tools/list")).status).toBe(401);
  });

  it("lets an admin disconnect someone's tools, and can be turned off", async () => {
    const { verifier, challenge } = pkce();
    const code = await authorize(challenge);
    const issued = await token({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    const alice = await as("alice");
    const bob = await as("bob");
    const revoked = await alice.call("POST", `/admin/mcp/people/${bob.user.id}/revoke`);
    expect(revoked.data.revoked).toBe(1);
    expect((await rpc(issued.data.access_token, "tools/list")).status).toBe(401);

    await alice.call("PUT", "/admin/mcp", { enabled: false });
    expect((await rpc(readToken, "tools/list")).status).toBe(403);
    // A new connection can't be allowed while it's off.
    const start = await fetch(
      authorizeUrl({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: pkce().challenge,
        code_challenge_method: "S256",
      }),
      { redirect: "manual" },
    );
    const request = new URL(start.headers.get("location")!).searchParams.get("request")!;
    const denied = await bob.call("POST", "/oauth/decision", { request, allow: true });
    expect(denied.status).toBe(403);
  });
});
