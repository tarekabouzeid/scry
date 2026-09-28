import { connectDemoLlm, resetDemo } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
});

test("another team says it needs something too", async ({ page }) => {
  await signIn(page, "lena");
  await page.goto("/?q=feature%20store");
  await page.getByText("Feature store").first().click();
  await expect(page.getByText("Also needed by · 2")).toBeVisible();
  await page.getByRole("button", { name: "We need this too" }).click();
  await page.getByPlaceholder("Why your team needs it").fill("Design tokens usage analytics");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Also needed by · 3")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTitle("Also needed by 3 other teams")).toBeVisible();
});

test("a duplicate is merged from its overlap card, once the other team accepts", async ({
  browser,
  page,
}) => {
  await signIn(page, "bob");
  await page.goto("/?q=account%20managers");
  await page.getByText("Customer analytics dashboards for account managers").first().click();
  await page.getByRole("button", { name: "Merge into it" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Growth is recorded as also needing/)).toBeVisible();
  // Priya's initiative, so bob only asks.
  await expect(dialog.getByText(/its owners and Data & ML's team admins decide/)).toBeVisible();
  // The flagged pair is the target; there's no picking another initiative.
  await expect(dialog.getByRole("button", { name: "Change" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Ask to merge" }).click();
  await expect(page.getByText("Asked Data & ML to accept the merge")).toBeVisible();
  const waiting = page.getByRole("region", { name: "Merge request" });
  await expect(waiting.getByText("Waiting to be merged")).toBeVisible();
  await expect(waiting.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await expect(page.getByText("Merge asked; waiting for them")).toBeVisible();

  // Opening the merge again says so, and can withdraw it right there.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Merge into…" }).click();
  await expect(dialog.getByText(/You already asked Data & ML/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Ask to merge" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Withdraw the request" }).click();
  await expect(dialog.getByRole("button", { name: "Ask to merge" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Ask to merge" }).click();
  await expect(waiting.getByText("Waiting to be merged")).toBeVisible();

  // Priya is notified and accepts from her initiative.
  const priyaContext = await browser.newContext();
  const priya = await priyaContext.newPage();
  await signIn(priya, "priya");
  await priya.goto("/");
  await priya.getByRole("button", { name: /Notifications \(\d+ unread\)/ }).click();
  // Bob asked twice (he withdrew once), so there are two; the newest is first.
  await priya
    .getByText(/asks to merge “Customer analytics dashboards for account managers”/)
    .first()
    .click();
  const asked = priya.getByRole("region", { name: "Merge request" });
  await expect(asked.getByText("Asked to merge into this")).toBeVisible();
  await asked.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(priya.getByText("Merged", { exact: true })).toBeVisible();
  await expect(asked).toHaveCount(0);
  await priyaContext.close();

  await page.goto("/?q=account%20managers");
  await page.getByText("Customer analytics dashboards for account managers").first().click();
  await expect(page.getByText(/This was a duplicate\. Work continues in/)).toBeVisible();
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(page.getByText(/merged this into/)).toBeVisible();
  await expect(page.getByText(/asked Data & ML to merge this into/).first()).toBeVisible();
});
