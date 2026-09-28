import { as, connectDemoLlm, resetDemo, userRow } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
  const bob = await userRow("bob");
  const alice = await as("alice");
  await alice.call("PATCH", `/users/${bob.id}`, { role: "admin" });
  await alice.call("PATCH", `/users/${bob.id}`, { role: "member" });
});

test("usage panel", async ({ page }) => {
  await signIn(page, "alice");
  await page.goto("/?view=admin&tab=ai");
  await expect(page.getByRole("heading", { name: "Usage", exact: true })).toBeVisible();
  await expect(page.getByText("Calls per hour")).toBeVisible();
  await page.getByRole("tab", { name: "7 days" }).click();
  await expect(page.getByText("Calls per day")).toBeVisible();
});

test("audit log lists, filters and shows details", async ({ page }) => {
  await signIn(page, "alice");
  await page.goto("/?view=admin&tab=audit");
  await expect(page.getByText(/Alice Chen connected the AI model/)).toBeVisible();
  await page.getByLabel("Filter by action").selectOption("user.role_changed");
  await expect(page.getByText(/changed Bob Martinez's role/)).toHaveCount(2);
  await expect(page.getByText(/connected the AI model/)).toHaveCount(0);
  await page.getByRole("button", { name: "Show details" }).first().click();
  await expect(page.getByText("from", { exact: true })).toBeVisible();
});

test("members can't reach admin pages", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=admin&tab=ai");
  await expect(page.getByText("Every initiative across every team")).toBeVisible();
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
});

test("AI settings work on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "alice");
  await page.goto("/?view=admin&tab=ai");
  await expect(page.getByRole("button", { name: "Test connection" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
