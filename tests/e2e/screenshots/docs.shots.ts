import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, type Locator, type Page } from "@playwright/test";
import { connectDemoLlm, initiativeId, resetDemo, sql, waitFor } from "../support/scry";
import { signIn } from "../ui/fixtures";

// Every image in docs/screenshots, from the seeded demo with the demo LLM
// connected. Sizes match what README.md and docs/user-guide.html declare.
const docs = fileURLToPath(new URL("../../../docs/", import.meta.url));
const shots = `${docs}screenshots/`;
mkdirSync(shots, { recursive: true });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Let entrance animations and charts finish.
  await page.waitForTimeout(800);
}

/** A fixed-size crop anchored to an element (for the user guide's close-ups). */
async function crop(
  page: Page,
  name: string,
  el: Locator,
  size: { width: number; height: number },
  offset: { x?: number; y?: number; center?: boolean } = {},
) {
  const box = (await el.boundingBox())!;
  const x = offset.center ? box.x + box.width / 2 - size.width / 2 : box.x + (offset.x ?? 0);
  await page.screenshot({
    path: `${shots}${name}.png`,
    clip: { x: Math.max(0, x), y: Math.max(0, box.y + (offset.y ?? 0)), ...size },
  });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  await resetDemo();
  await connectDemoLlm();
  // Screens show TL;DRs and similarity, so wait for the background jobs.
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
});

test("workspace views", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=table");
  await page.getByText("possible cross-team overlap").waitFor();
  await settle(page);
  await page.screenshot({ path: `${shots}initiatives.png` });
  await crop(page, "guide-sidebar", page.locator("aside").first(), { width: 256, height: 520 });

  await page.goto("/?view=kanban&group=team");
  await settle(page);
  await page.screenshot({ path: `${shots}board.png` });

  await page.goto("/?view=timeline");
  await settle(page);
  await page.screenshot({ path: `${shots}timeline.png` });

  // The graph opens on the whole organisation; the search frames the teams
  // with matches.
  await page.goto("/?view=graph");
  await page.getByRole("status").filter({ hasText: "on the map" }).waitFor();
  const search = page.getByPlaceholder("Semantic search the graph…");
  await search.fill("passwordless login");
  await search.press("Enter");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${shots}graph.png` });

  await page.goto("/");
  await page
    .getByRole("button", { name: /Jump to/ })
    .first()
    .click();
  const palette = page.getByPlaceholder("Jump to an initiative, team or view…");
  await palette.fill("passkeys");
  await page.waitForTimeout(500);
  await crop(
    page,
    "guide-jump-to",
    page.getByRole("dialog"),
    { width: 640, height: 300 },
    {
      center: true,
      y: -28,
    },
  );
});

test("light theme and phone", async ({ browser }) => {
  const light = await browser.newPage({
    colorScheme: "light",
    viewport: { width: 1440, height: 900 },
  });
  await signIn(light, "bob");
  await light.goto("/?view=table");
  await light.getByText("possible cross-team overlap").waitFor();
  await settle(light);
  await light.screenshot({ path: `${shots}initiatives-light.png` });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await signIn(phone, "bob");
  await phone.goto("/?view=table");
  await settle(phone);
  await phone.screenshot({ path: `${shots}mobile.png` });
});

test("initiative details", async ({ page }) => {
  await signIn(page, "bob");
  const panel = page.getByRole("complementary", { name: "Initiative details" });

  await page.goto(
    `/?i=${await initiativeId("Customer analytics dashboards for account managers")}`,
  );
  await panel.getByText(/Possible overlap/).waitFor();
  await settle(page);
  await page.screenshot({ path: `${shots}overlap.png` });

  await page.goto(`/?i=${await initiativeId("Feature store")}`);
  await panel.getByText(/Also needed by/).waitFor();
  await settle(page);
  await page.screenshot({ path: `${shots}demand.png` });

  await page.goto(`/?i=${await initiativeId("Passkeys for customer login")}`);
  await panel.getByText("TL;DR", { exact: true }).waitFor();
  await settle(page);
  const title = panel.getByRole("heading", { name: "Passkeys for customer login" });
  await crop(page, "guide-tldr", title, { width: 432, height: 420 }, { x: -20, y: -52 });
});

test("new initiative", async ({ page }) => {
  await signIn(page, "priya");
  await page.goto("/");
  await page
    .locator("aside")
    .getByRole("button", { name: /New initiative/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "New initiative" });
  await dialog
    .getByLabel("Describe it in your own words")
    .fill(
      "Account managers can't see which customers are about to churn until it's too late. We want a weekly churn risk list for account managers, so they can call at-risk customers before renewal.",
    );
  await dialog.getByRole("button", { name: "Draft", exact: true }).click();
  await dialog.getByText("Filled in by AI from your description.").waitFor();
  await settle(page);
  await page.screenshot({ path: `${shots}guide-new-initiative.png` });
  await page.keyboard.press("Escape");

  await signIn(page, "bob");
  await page.goto("/");
  await page
    .locator("aside")
    .getByRole("button", { name: /New initiative/ })
    .click();
  await dialog.getByRole("button", { name: "Skip" }).click();
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Passwordless login");
  await dialog
    .getByLabel("Summary")
    .fill("Let customers sign in with passkeys instead of passwords.");
  await dialog.getByText("This may already exist").waitFor();
  await settle(page);
  await crop(page, "guide-similar-work", dialog, { width: 768, height: 520 });
});

test("ask scry", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=chat");
  await page
    .getByRole("button", { name: /Passwordless login for customers using passkeys/ })
    .click();
  await page.getByText(/talk to Omar Haddad/).waitFor();
  await page.getByText(/Evidence · \d/).waitFor();
  await settle(page);
  await page.screenshot({ path: `${shots}ask-scry.png` });
});

test("brief, team and admin", async ({ page, browser }) => {
  await signIn(page, "alice");
  await page.goto("/?view=brief");
  await page.getByText("Decisions for you").waitFor();
  await settle(page);
  await page.screenshot({ path: `${shots}brief.png` });

  // The sample PDF is the light, printed brief.
  const print = await browser.newPage({ colorScheme: "light" });
  await signIn(print, "alice");
  await print.goto("/?view=brief");
  await print.getByText("Decisions for you").waitFor();
  await settle(print);
  mkdirSync(`${docs}samples`, { recursive: true });
  await print.pdf({
    path: `${docs}samples/portfolio-brief.pdf`,
    format: "A4",
    printBackground: true,
  });

  await page.goto("/?view=admin&tab=ai");
  await page.getByText("Calls per hour").waitFor();
  await settle(page);
  await page.screenshot({ path: `${shots}ai-settings.png` });

  await page.goto("/?view=admin&tab=audit");
  await settle(page);
  await page.screenshot({ path: `${shots}audit-log.png` });

  // Priya runs Data & ML, where Noah is waiting to join.
  await signIn(page, "priya");
  await page.goto("/?view=team");
  await page.getByText("Noah Fischer").first().waitFor();
  await settle(page);
  await page.screenshot({ path: `${shots}team.png` });
});
