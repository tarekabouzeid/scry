// Start (or stop) everything the e2e suites talk to, from built output:
//   node scripts/stack.mjs start   |   node scripts/stack.mjs stop
// Postgres (pgvector) and Redis must already be running — locally via
// `docker compose -f infra/docker/docker-compose.yml up -d`, in CI as
// services. Run `pnpm build` first. Logs and PIDs go to tests/e2e/.stack/.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const stateDir = join(root, "tests/e2e/.stack");
const pidFile = join(stateDir, "pids.json");

export const stackEnv = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://scry:scry@localhost:5432/scry",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-session-secret-0123456789abcdef0123456789",
};

const apiEnv = {
  ...stackEnv,
  API_PORT: "3001",
  WEB_ORIGIN: "http://localhost:3000",
  // Nothing listens here: sign-in isn't exercised (suites mint sessions
  // directly), and the api discovers its IdP lazily, so it boots fine.
  OIDC_ISSUER_URL: "http://localhost:9999",
  OIDC_CLIENT_ID: "scry-e2e",
  OIDC_CLIENT_SECRET: "unused",
  OIDC_REDIRECT_URI: "http://localhost:3001/auth/callback",
};

const services = [
  {
    name: "demo-llm",
    script: "infra/docker/demo-llm/server.mjs",
    env: { PORT: "4010" },
    health: "http://localhost:4010/health",
  },
  {
    name: "demo-llm-secured",
    script: "infra/docker/demo-llm/server.mjs",
    env: {
      PORT: "4011",
      DEMO_LLM_API_KEY: "e2e-demo-key",
      DEMO_LLM_JWKS_URL: "http://localhost:3001/.well-known/jwks.json,http://localhost:9998/certs",
      DEMO_LLM_JWT_AUDIENCE: "litellm",
    },
    health: "http://localhost:4011/health",
  },
  {
    name: "fake-idp",
    script: "tests/e2e/support/fake-idp.mjs",
    cwd: "tests/e2e",
    env: { PORT: "9998" },
    health: "http://localhost:9998/certs",
  },
  {
    name: "api",
    script: "apps/api/dist/main.js",
    cwd: "apps/api",
    env: apiEnv,
    health: "http://localhost:3001/health",
  },
  {
    name: "web",
    script: "apps/web/node_modules/next/dist/bin/next",
    args: ["start", "-p", "3000"],
    cwd: "apps/web",
    env: {},
    health: "http://localhost:3000/",
  },
];

async function waitHealthy(url, name, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} didn't become healthy at ${url} — see tests/e2e/.stack/${name}.log`);
}

export async function start() {
  if (existsSync(pidFile)) await stop();
  mkdirSync(stateDir, { recursive: true });
  for (const required of [
    "apps/api/dist/main.js",
    "packages/db/dist/migrate.js",
    "apps/web/.next/BUILD_ID",
  ]) {
    if (!existsSync(join(root, required)))
      throw new Error(`Missing ${required} — run \`pnpm build\` first`);
  }
  console.log("Applying migrations…");
  execFileSync(process.execPath, [join(root, "packages/db/dist/migrate.js")], {
    env: { ...process.env, ...stackEnv },
    stdio: "inherit",
  });
  // Something already answering would pass the health checks below and the
  // suites would silently test it instead (e.g. a dev api with another secret).
  for (const svc of services) {
    const busy = await fetch(svc.health).then(
      () => true,
      () => false,
    );
    if (busy)
      throw new Error(`${svc.health} is already in use — stop whatever is running there first`);
  }
  const pids = {};
  for (const svc of services) {
    const log = openSync(join(stateDir, `${svc.name}.log`), "w");
    const child = spawn(process.execPath, [join(root, svc.script), ...(svc.args ?? [])], {
      cwd: join(root, svc.cwd ?? "."),
      env: { ...process.env, ...svc.env },
      stdio: ["ignore", log, log],
      detached: true,
    });
    child.unref();
    pids[svc.name] = child.pid;
    writeFileSync(pidFile, JSON.stringify(pids, null, 2));
    await waitHealthy(svc.health, svc.name);
    console.log(`  ✓ ${svc.name}`);
  }
}

export async function stop() {
  if (!existsSync(pidFile)) return;
  const pids = JSON.parse(readFileSync(pidFile, "utf8"));
  for (const [name, pid] of Object.entries(pids)) {
    try {
      process.kill(-pid, "SIGTERM"); // the whole process group (next start spawns a child)
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    console.log(`  ■ ${name}`);
  }
  rmSync(pidFile);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (action === "start") await start();
  else if (action === "stop") await stop();
  else {
    console.error("usage: node scripts/stack.mjs start|stop");
    process.exit(2);
  }
}
