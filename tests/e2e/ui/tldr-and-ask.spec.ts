import { connectDemoLlm, initiativeId, resetDemo, sql, waitFor } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
  await waitFor(
    async () => {
      const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from initiatives where tldr is null and merged_into_id is null`;
      return n === 0;
    },
    "TL;DRs",
    30_000,
  );
});

test("the details panel leads with an AI-written TL;DR", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto(`/?i=${await initiativeId("Passkeys for customer login")}`);
  const panel = page.getByRole("complementary", { name: "Initiative details" });
  await expect(panel.getByText("TL;DR", { exact: true })).toBeVisible();
  await expect(panel.getByText(/on hold: paused until Enterprise SSO/)).toBeVisible();
});

test("Ask Scry is a place in the workspace, and anything typed in ⌘K can go to it", async ({
  page,
}) => {
  await signIn(page, "bob");
  await page.goto("/");
  await expect(page.locator("aside nav").getByRole("button", { name: "Ask Scry" })).toBeVisible();
  await page.getByRole("button", { name: /Jump to/ }).click();
  await page.getByPlaceholder(/Jump to an initiative/).fill("Passwordless login for customers");
  const ask = page.getByRole("option", { name: "Ask Scry: “Passwordless login for customers”" });
  await expect(ask).toBeVisible();
  await ask.click();
  await expect(page).toHaveURL(/view=chat/);
  await expect(page.getByText("Passwordless login for customers").first()).toBeVisible();
  await expect(page.getByText(/Passkeys for customer login/).first()).toBeVisible();
});

test("the New initiative dialog can hand the idea to Ask Scry instead", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/");
  await page
    .locator("aside")
    .getByRole("button", { name: /New initiative/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "New initiative" });
  await dialog
    .getByLabel("Describe it in your own words")
    .fill("Passwordless login for customers using passkeys");
  await dialog.getByRole("button", { name: "Ask Scry first" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/view=chat/);
  await expect(page.getByText(/Passkeys for customer login/).first()).toBeVisible();
});
