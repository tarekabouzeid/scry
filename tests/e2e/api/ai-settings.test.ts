import { beforeAll, describe, expect, it } from "vitest";
import { env } from "../support/env";
import { as, resetDemo, sql, waitFor } from "../support/scry";

// The "secured" demo LLM (scripts/stack.mjs) requires the API key
// e2e-demo-key, or an RS256 JWT with audience "litellm" signed by a key in
// Scry's JWKS or the stand-in IdP's.

let defaults: any;
const draft = (patch: (s: any) => void = () => undefined) => {
  const s = structuredClone(defaults);
  s.connection.baseUrl = env.securedLlmUrl;
  patch(s);
  return s;
};
const allOk = (results: any[]) => results.every((r) => r.ok);

beforeAll(async () => {
  await resetDemo();
  defaults = (await (await as("alice")).call("GET", "/admin/llm")).data.defaults;
});

describe("before any model is connected", () => {
  it("AI features say so, everything else works", async () => {
    const bob = await as("bob");
    expect((await bob.call("GET", "/llm/status")).data).toEqual({
      configured: false,
      source: "none",
      matching: { strongMatch: 0.85, weakMatch: 0.65 },
    });
    const session = await bob.call("POST", "/chat/sessions");
    const chat = await bob.call("POST", `/chat/sessions/${session.data.id}/messages`, {
      content: "passkeys",
    });
    expect(chat.status).toBe(503);
    expect(chat.data.message).toMatch(/Admin → AI & models/);
    expect((await bob.call("GET", "/search?q=passkeys")).status).toBe(503);
    expect((await bob.call("GET", "/initiatives")).status).toBe(200);
  });

  it("only admins can read or change AI settings", async () => {
    expect((await (await as("bob")).call("GET", "/admin/llm")).status).toBe(403);
  });
});

describe("authentication modes", () => {
  it("no auth: the gateway's refusal is reported per role", async () => {
    const r = await (await as("alice")).call("POST", "/admin/llm/test", { settings: draft() });
    expect(r.data).toHaveLength(3);
    for (const role of r.data) expect(role.error).toMatch(/401|Missing bearer/);
  });

  it("API key", async () => {
    const alice = await as("alice");
    const keyed = draft((s) => (s.connection.auth.mode = "api_key"));
    expect(
      allOk(
        (
          await alice.call("POST", "/admin/llm/test", {
            settings: keyed,
            secrets: { apiKey: "wrong" },
          })
        ).data,
      ),
    ).toBe(false);
    const ok = await alice.call("POST", "/admin/llm/test", {
      settings: keyed,
      secrets: { apiKey: env.securedLlmKey },
    });
    expect(allOk(ok.data)).toBe(true);
    expect(ok.data[0].detail).toBe("1536-dimensional vectors");
  });

  it("OAuth2 client credentials, basic and post", async () => {
    const alice = await as("alice");
    const oauth = draft((s) =>
      Object.assign(s.connection.auth, {
        mode: "oauth2_client_credentials",
        tokenUrl: `${env.idpUrl}/token`,
        clientId: "scry-llm",
        scope: "litellm",
      }),
    );
    const bad = await alice.call("POST", "/admin/llm/test", {
      settings: oauth,
      secrets: { clientSecret: "nope" },
    });
    expect(bad.data[0].error).toMatch(/Invalid client credentials/);
    expect(
      allOk(
        (
          await alice.call("POST", "/admin/llm/test", {
            settings: oauth,
            secrets: { clientSecret: "llm-secret" },
          })
        ).data,
      ),
    ).toBe(true);
    oauth.connection.auth.clientAuthMethod = "client_secret_post";
    expect(
      allOk(
        (
          await alice.call("POST", "/admin/llm/test", {
            settings: oauth,
            secrets: { clientSecret: "llm-secret" },
          })
        ).data,
      ),
    ).toBe(true);
  });

  it("JWT signed by Scry, verified against its JWKS; rotation keeps working", async () => {
    const alice = await as("alice");
    const key = await alice.call("POST", "/admin/llm/signing-key");
    const kid = key.data.signingKey.keyId;
    const jwks = await (await fetch(`${env.apiUrl}/.well-known/jwks.json`)).json();
    expect(jwks.keys.map((k: any) => k.kid)).toEqual([kid]);
    expect(jwks.keys[0]).not.toHaveProperty("d");

    const signed = draft((s) =>
      Object.assign(s.connection.auth, {
        mode: "signed_jwt",
        audience: "litellm",
        extraClaims: { scope: "litellm_proxy_admin" },
      }),
    );
    expect(allOk((await alice.call("POST", "/admin/llm/test", { settings: signed })).data)).toBe(
      true,
    );
    const wrongAudience = structuredClone(signed);
    wrongAudience.connection.auth.audience = "someone-else";
    const refused = await alice.call("POST", "/admin/llm/test", { settings: wrongAudience });
    expect(refused.data[0].error).toMatch(/audience/);

    const rotated = await alice.call("POST", "/admin/llm/signing-key");
    expect(rotated.data.signingKey.activatesAt).toBeTruthy();
    const both = await (await fetch(`${env.apiUrl}/.well-known/jwks.json`)).json();
    expect(both.keys).toHaveLength(2);
    expect(allOk((await alice.call("POST", "/admin/llm/test", { settings: signed })).data)).toBe(
      true,
    );
  });
});

describe("saving", () => {
  it("validates field by field", async () => {
    const bad = draft((s) => ((s.connection.baseUrl = "ftp://x"), (s.matching.weakMatch = 0.99)));
    const r = await (await as("alice")).call("PUT", "/admin/llm", { settings: bad });
    expect(r.status).toBe(400);
    expect(r.data.message).toHaveLength(2);
  });

  it("stores credentials encrypted and never returns them, then indexes", async () => {
    const alice = await as("alice");
    const keyed = draft((s) => (s.connection.auth.mode = "api_key"));
    const r = await alice.call("PUT", "/admin/llm", {
      settings: keyed,
      secrets: { apiKey: env.securedLlmKey },
    });
    expect(r.status).toBe(200);
    expect(r.data.secrets.apiKey).toBe(true);
    expect(JSON.stringify(r.data)).not.toContain(env.securedLlmKey);
    const [row] = await sql<{ secrets: string }[]>`select secrets from llm_settings`;
    expect(row!.secrets.startsWith("v1.")).toBe(true);
    expect(row!.secrets).not.toContain(env.securedLlmKey);
    expect((await (await as("bob")).call("GET", "/llm/status")).data.configured).toBe(true);
    await waitFor(
      async () => (await alice.call("GET", "/admin/llm")).data.indexing.indexed === 22,
      "indexing",
    );
  });

  it("keeps the stored key when saved without secrets", async () => {
    const alice = await as("alice");
    const r = await alice.call("PUT", "/admin/llm", {
      settings: draft((s) => (s.connection.auth.mode = "api_key")),
    });
    expect(r.data.secrets.apiKey).toBe(true);
  });

  it("Ask Scry and drafting work once connected", async () => {
    const bob = await as("bob");
    const session = await bob.call("POST", "/chat/sessions");
    const chat = await bob.call("POST", `/chat/sessions/${session.data.id}/messages`, {
      content: "Passwordless login for customers using passkeys",
    });
    expect(chat.status).toBe(201);
    expect(chat.data.classification).toBe("STRONG_MATCH");
    const drafted = await bob.call("POST", `/chat/sessions/${session.data.id}/draft`);
    expect(drafted.data.title).toBeTruthy();
  });
});

describe("embedding size", () => {
  it("Test connection reports a model's real size", async () => {
    const alice = await as("alice");
    const s768 = draft(
      (s) => ((s.connection.auth.mode = "api_key"), (s.models.embedding.model = "demo-embed-768")),
    );
    const r = await alice.call("POST", "/admin/llm/test", { settings: s768 });
    expect(r.data[0]).toMatchObject({ ok: false, actualDimensions: 768 });
  });

  it("changing the size re-indexes everything, and search keeps working", async () => {
    const alice = await as("alice");
    const s768 = draft((s) => {
      s.connection.auth.mode = "api_key";
      s.models.embedding.model = "demo-embed-768";
      s.models.embedding.dimensions = 768;
    });
    const saved = await alice.call("PUT", "/admin/llm", { settings: s768 });
    expect(saved.data.reindex.reset).toBe(true);
    await waitFor(async () => {
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*) filter (where vector_dims(embedding) = 768)::int as n from initiatives`;
      return n === 22;
    }, "768-d re-index");
    const found = await (await as("bob")).call("GET", "/search?q=passwordless%20login");
    expect(found.data.some((r: any) => /Passkeys/.test(r.initiative.title))).toBe(true);
  });

  it("another model of the same size re-indexes too, never mixing the two", async () => {
    const alice = await as("alice");
    const [{ key: oldKey }] = await sql<{ key: string }[]>`
      select min(embedding_key) as key from initiatives`;
    const other = draft((s) => {
      s.connection.auth.mode = "api_key";
      s.models.embedding.model = "other-embed-768";
      s.models.embedding.dimensions = 768;
    });
    const saved = await alice.call("PUT", "/admin/llm", { settings: other });
    expect(saved.data.reindex.reset).toBe(true);
    await waitFor(async () => {
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from initiatives where embedding_key is distinct from ${oldKey}`;
      return n === 22;
    }, "same-size re-index");
    const progress = (await alice.call("GET", "/admin/llm")).data.indexing;
    expect(progress).toEqual({ total: 22, indexed: 22 });
    const found = await (await as("bob")).call("GET", "/search?q=passwordless%20login");
    expect(found.data.some((r: any) => /Passkeys/.test(r.initiative.title))).toBe(true);
  });
});

describe("removing settings", () => {
  it("falls back to the environment (none here)", async () => {
    const r = await (await as("alice")).call("DELETE", "/admin/llm");
    expect(r.data.source).toBe("none");
  });
});
