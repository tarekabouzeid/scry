import { mkdirSync } from "node:fs";
import { test } from "@playwright/test";
import { connectDemoLlm, initiativeId, resetDemo, sql, waitFor } from "../support/scry";
import { signIn } from "../ui/fixtures";

// Records a short browse of the seeded demo as video; scripts/demo-gif.mjs
// turns it into docs/screenshots/demo.gif.
const out = process.env.DEMO_VIDEO_DIR ?? "/tmp/scry-demo-video";
mkdirSync(out, { recursive: true });

test.use({
  viewport: { width: 1280, height: 760 },
  video: { mode: "on", size: { width: 1280, height: 760 } },
});

const pause = (page: import("@playwright/test").Page, ms = 1500) => page.waitForTimeout(ms);

test("browse scry", async ({ page }) => {
  test.setTimeout(240_000);
  await resetDemo();
  await connectDemoLlm();
  await waitFor(
    async () => {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from initiatives
        where merged_into_id is null and (tldr is null or embedding is null)`;
      return row!.n === 0;
    },
    "embeddings and TL;DRs",
    120_000,
  );
  const overlapId = await initiativeId("Customer analytics dashboards for account managers");
  const demandId = await initiativeId("Feature store");

  await signIn(page, "bob");
  await page.goto("/?view=table");
  await page.getByText("possible cross-team overlap").waitFor();
  await pause(page, 2500);

  await page.goto(`/?view=table&i=${overlapId}`);
  await page
    .getByText(/Possible overlap/)
    .first()
    .waitFor();
  await pause(page, 3000);

  await page.goto(`/?view=table&i=${demandId}`);
  await page.getByText(/Also needed by/).waitFor();
  await pause(page, 2500);

  await page.goto("/?view=kanban&group=team");
  await pause(page, 2500);

  await page.goto("/?view=graph");
  await page.getByRole("status").filter({ hasText: "on the map" }).waitFor();
  await pause(page, 3000);

  await page.goto("/?view=chat");
  await page
    .getByRole("button", { name: /Passwordless login for customers using passkeys/ })
    .click();
  await page.getByText(/Evidence · \d/).waitFor();
  await pause(page, 4000);

  await page.goto("/?view=brief");
  await pause(page, 3000);
  await page.close();
  await page.video()?.saveAs(`${out}/demo.webm`);
});
