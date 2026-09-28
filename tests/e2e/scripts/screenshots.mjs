// Retake docs/screenshots (and the sample brief PDF) from the seeded demo:
//   pnpm build && pnpm --filter @scry/e2e screenshots
// Like the e2e run, it starts its own stack and WIPES DATABASE_URL. Set
// E2E_EXTERNAL_STACK=1 to use a stack you started with `stack.mjs start`.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start, stop, stackEnv } from "./stack.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const external = process.env.E2E_EXTERNAL_STACK === "1";

let status = 1;
try {
  if (!external) await start();
  status =
    spawnSync("npx", ["playwright", "test", "-c", "playwright.screenshots.config.ts"], {
      cwd: here,
      stdio: "inherit",
      env: { ...process.env, ...stackEnv },
    }).status ?? 1;
} finally {
  if (!external) await stop();
}
process.exit(status);
