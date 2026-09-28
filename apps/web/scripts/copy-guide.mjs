// Serves the user guide (docs/user-guide.html) from the web app at
// /guide/index.html, with the screenshots it uses. Runs before dev and build,
// so the guide in the app is always the one in docs/.
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, "apps/web/public/guide");
const html = readFileSync(join(root, "docs/user-guide.html"), "utf8");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "screenshots"), { recursive: true });
copyFileSync(join(root, "docs/user-guide.html"), join(out, "index.html"));
const images = new Set([...html.matchAll(/screenshots\/([\w.-]+\.png)/g)].map((m) => m[1]));
for (const image of images)
  copyFileSync(join(root, "docs/screenshots", image), join(out, "screenshots", image));
console.log(`User guide copied with ${images.size} screenshots`);
