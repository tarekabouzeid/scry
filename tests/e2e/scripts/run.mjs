// The whole e2e run: start the stack, run the API suites, then the browser
// suites, and always stop the stack. Set E2E_EXTERNAL_STACK=1 to test a stack
// you started yourself (then nothing is started or stopped).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start, stop, stackEnv } from "./stack.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const external = process.env.E2E_EXTERNAL_STACK === "1";
const run = (cmd, args) =>
  spawnSync(cmd, args, { cwd: here, stdio: "inherit", env: { ...process.env, ...stackEnv } })
    .status ?? 1;

let status = 1;
try {
  if (!external) await start();
  status = run("npx", ["vitest", "run", "--config", "vitest.config.ts"]);
  if (status === 0 || process.env.E2E_CONTINUE_ON_FAILURE === "1") {
    const ui = run("npx", ["playwright", "test"]);
    status = status || ui;
  }
} finally {
  if (!external) await stop();
}
process.exit(status);
