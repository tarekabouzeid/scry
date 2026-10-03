// Re-record docs/screenshots/demo.gif from the seeded demo:
//   pnpm build && pnpm --filter @scry/e2e demo-gif
// Starts its own stack and WIPES DATABASE_URL. Needs ffmpeg. Set CHROMIUM_PATH
// to use a browser you already have instead of Playwright's.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start, stop, stackEnv } from "./stack.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.env.DEMO_VIDEO_DIR ?? "/tmp/scry-demo-video";
const gif = join(here, "../../docs/screenshots/demo.gif");
const env = { ...process.env, ...stackEnv, DEMO_VIDEO_DIR: dir };

let status = 1;
try {
  await start();
  status =
    spawnSync("npx", ["playwright", "test", "-c", "playwright.record.config.ts"], {
      cwd: here,
      stdio: "inherit",
      env,
    }).status ?? 1;
} finally {
  await stop();
}
if (status === 0) {
  const filter =
    "fps=6,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];" +
    "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
  status =
    spawnSync(
      "ffmpeg",
      ["-v", "error", "-y", "-i", join(dir, "demo.webm"), "-vf", filter, "-loop", "0", gif],
      { stdio: "inherit" },
    ).status ?? 1;
}
process.exit(status);
