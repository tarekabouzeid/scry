import { resetDemo, sql, userRow } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeEach(async () => {
  await resetDemo();
  await sql`update users set tour_seen_at = null where email = 'bob@example.com'`;
});

async function seen() {
  const bob = await userRow("bob");
  const [row] = await sql<{ at: Date | null }[]>`
    select tour_seen_at as at from users where id = ${bob.id}`;
  return row!.at;
}

test("first visit: the tour walks through the app once", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=graph");
  const tour = page.getByRole("dialog", { name: "Welcome to Scry" });
  await expect(tour).toBeVisible();
  // It starts from the Initiatives page.
  await expect(page).not.toHaveURL(/view=graph/);
  await tour.getByRole("button", { name: "Show me" }).click();

  const titles: string[] = [];
  for (;;) {
    const card = page.locator("[data-product-tour] [role=dialog]");
    titles.push((await card.locator("h2").textContent()) ?? "");
    const done = card.getByRole("button", { name: "Done" });
    if (await done.isVisible()) {
      await done.click();
      break;
    }
    await page.keyboard.press("ArrowRight");
  }
  expect(titles).toEqual([
    "Share your work",
    "See everyone's work",
    "Open any initiative",
    "Ask before you build",
    "Find anything",
    "Stay in the loop",
    "The big picture",
    // Bob runs Growth, so he's shown where his team page is.
    "Run your team",
    "Help is here",
  ]);
  await expect(page.locator("[data-product-tour]")).toHaveCount(0);
  await expect.poll(seen).not.toBeNull();

  // Not again on the next visit…
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  await page.waitForTimeout(1200);
  await expect(page.locator("[data-product-tour]")).toHaveCount(0);

  // …but always available from Help.
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Scry" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-product-tour]")).toHaveCount(0);
});

test("skipping counts as seen", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/");
  await page
    .getByRole("dialog", { name: "Welcome to Scry" })
    .getByRole("button", { name: "Skip" })
    .click();
  await expect.poll(seen).not.toBeNull();
});

test("Help opens the user guide and the keyboard shortcuts", async ({ page, context }) => {
  await sql`update users set tour_seen_at = now()`;
  await signIn(page, "bob");
  await page.goto("/");
  await page.locator("tbody tr").first().waitFor();

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Help" }).click();
  const [guide] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "User guide" }).click(),
  ]);
  await guide.waitForLoadState();
  await expect(guide.getByRole("heading", { name: "Scry", level: 1 })).toBeVisible();
  const image = await guide.request.get(new URL("screenshots/ask-scry.png", guide.url()).href);
  expect(image.status()).toBe(200);
});
