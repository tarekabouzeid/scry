import { connectDemoLlm, resetDemo } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
});

test("New initiative is up front, and warns about work that already exists", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=graph");
  await page
    .locator("aside")
    .getByRole("button", { name: /New initiative/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "New initiative" });
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Passwordless login");
  await dialog
    .getByLabel("Summary")
    .fill("Let customers sign in with passkeys instead of passwords.");
  const similar = dialog.getByRole("status").filter({ hasText: "This may already exist" });
  await expect(similar).toBeVisible();
  await expect(similar.getByRole("link", { name: /Passkeys for customer login/ })).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(similar).toContainText("talk to Omar Haddad");
});

test("C opens it from anywhere, but not while typing", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/");
  await page.getByPlaceholder("Search titles and summaries…").fill("c");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("body").click({ position: { x: 700, y: 20 } });
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog", { name: "New initiative" })).toBeVisible();
});

test("AI drafts the fields from a description, and Undo puts them back", async ({ page }) => {
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
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Weekly churn risk list for account managers",
  );
  await expect(dialog.getByText("Filled in by AI from your description.")).toBeVisible();
  await expect(dialog.getByText("Who it's for", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Undo" }).click();
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
});

test("Suggest improvements proposes edits the author picks one by one", async ({ page }) => {
  await signIn(page, "priya");
  await page.goto("/");
  await page
    .locator("aside")
    .getByRole("button", { name: /New initiative/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "New initiative" });
  await dialog.getByRole("button", { name: "Skip" }).click();
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("churn scores.");
  await dialog.getByLabel("Summary").fill("Weekly churn risk scores for account managers.");
  await dialog.getByRole("button", { name: "Suggest improvements" }).click();
  const suggestions = dialog.getByRole("region", { name: "AI suggestions" });
  await expect(suggestions).toBeVisible();
  // Nothing changes until a suggestion is picked.
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "churn scores.",
  );
  await suggestions.getByRole("button", { name: "Use suggested title" }).click();
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Churn scores",
  );
  await suggestions.getByRole("button", { name: "Add tag churn" }).click();
  await expect(dialog.getByText("#churn")).toBeVisible();
  await expect(dialog.getByText("Why it matters", { exact: true })).toBeVisible();
});

test("a slow draft can be stopped, and the form stays as the author left it", async ({ page }) => {
  await page.route("**/initiatives/assist", () => {});
  await signIn(page, "priya");
  await page.goto("/");
  await page
    .locator("aside")
    .getByRole("button", { name: /New initiative/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "New initiative" });
  await dialog
    .getByLabel("Describe it in your own words")
    .fill("A weekly churn risk list so account managers can call at-risk customers.");
  await dialog.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Drafting…" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Stop" }).click();
  await expect(dialog.getByRole("button", { name: "Draft", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
});
