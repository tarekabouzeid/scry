import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import postgres from "postgres";
import { env } from "./env";

export const sql = postgres(env.databaseUrl, { max: 2, onnotice: () => undefined });

export type Person =
  "alice" | "dan" | "bob" | "sam" | "carol" | "priya" | "lena" | "omar" | "noah" | "mia";

const seedScript = fileURLToPath(new URL("../../../packages/db/dist/seed.js", import.meta.url));

/**
 * Wipe the database back to the demo story (docs/demo.md), with no AI
 * configured. Suites call this first so they don't depend on each other.
 */
export async function resetDemo() {
  execFileSync(process.execPath, [seedScript], {
    env: { ...process.env, DATABASE_URL: env.databaseUrl, SEED_RESET: "true" },
    stdio: "pipe",
  });
  // The product tour opens on a first visit; specs that aren't about it
  // start with it already seen (ui/tour.spec.ts clears it).
  await sql`update users set tour_seen_at = now()`;
  // The seed cleared llm_settings behind the api's back; tell every replica.
  await (await as("alice")).call("DELETE", "/admin/llm");
}

export async function userRow(person: Person) {
  const [row] = await sql<{ id: string; role: string; team_id: string | null; name: string }[]>`
    select id, role, team_id, name from users where email = ${`${person}@example.com`}`;
  if (!row) throw new Error(`No demo user ${person} — was the database seeded?`);
  return row;
}

/** A session cookie for a demo user, signed like the api's own (no IdP round trip). */
export async function sessionFor(person: Person) {
  const user = await userRow(person);
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    // Unique per call, so each test gets its own rate-limit budget.
    .setJti(crypto.randomUUID())
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.sessionSecret));
  return { user, token };
}

export interface ApiResponse<T = any> {
  status: number;
  data: T;
}

/** An api client acting as a demo user. */
export async function as(person: Person) {
  const { user, token } = await sessionFor(person);
  const call = async <T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> => {
    const res = await fetch(env.apiUrl + path, {
      method,
      headers: { cookie: `scry_session=${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep the raw text */
    }
    return { status: res.status, data };
  };
  return { user, token, call };
}

export async function initiativeId(title: string) {
  const [row] = await sql<{ id: string }[]>`select id from initiatives where title = ${title}`;
  if (!row) throw new Error(`No initiative "${title}"`);
  return row.id;
}

/** Connect the (unauthenticated) demo LLM as alice — what the demo's step 0 does. */
export async function connectDemoLlm() {
  const alice = await as("alice");
  const view = await alice.call("GET", "/admin/llm");
  const settings = view.data.defaults;
  settings.connection.baseUrl = env.llmUrl;
  const saved = await alice.call("PUT", "/admin/llm", { settings });
  if (saved.status !== 200)
    throw new Error(`Couldn't connect the demo LLM: ${JSON.stringify(saved.data)}`);
  await waitFor(async () => {
    const [{ pending }] = await sql<{ pending: number }[]>`
      select count(*)::int as pending from initiatives where embedding is null`;
    return pending === 0;
  }, "initiatives to be indexed");
  return settings;
}

export async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
