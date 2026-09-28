import { resetDemo } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
});

test("a newcomer asks to join, looks around, and the team admin lets them in", async ({
  browser,
}) => {
  const carol = await (await browser.newContext()).newPage();
  await signIn(carol, "carol");
  await carol.goto("/");
  await carol.getByRole("button", { name: "Ask to join" }).first().click();
  await carol.getByText("Growth", { exact: true }).click();
  await carol.getByRole("button", { name: "Ask to join" }).last().click();

  // In, but read-only, with a banner saying what for.
  await expect(carol.getByText("Waiting for Growth to let you in.")).toBeVisible();
  await carol
    .locator("aside")
    .getByRole("button", { name: /New initiative/ })
    .click();
  await expect(carol.getByText(/once a team admin lets you in/)).toBeVisible();
  await expect(carol.getByRole("dialog", { name: "New initiative" })).toHaveCount(0);

  const bob = await (await browser.newContext()).newPage();
  await signIn(bob, "bob");
  await bob.goto("/");
  const team = bob.locator("aside").getByRole("button", { name: /^Team/ });
  await expect(team).toContainText("1");
  await team.click();
  await bob.getByRole("button", { name: "Let in" }).click();
  await expect(bob.getByText("Nobody is waiting to join.")).toBeVisible();
  await expect(bob.getByText("Carol Nguyen", { exact: true })).toBeVisible();
  await expect(bob.getByText(/Bob Martinez let Carol Nguyen join Growth/)).toBeVisible();

  await carol.reload();
  await expect(carol.getByText("Waiting for Growth to let you in.")).toHaveCount(0);
});

test("creating a team uses the organisation's org units and countries", async ({ page }) => {
  // Noah is waiting to join Data & ML; he withdraws and asks for a new team instead.
  await signIn(page, "noah");
  await page.goto("/");
  await expect(page.getByText("Waiting for Data & ML to let you in.")).toBeVisible();
  await page.getByRole("button", { name: "Withdraw" }).click();
  await page.getByRole("button", { name: "Create a team" }).click();
  await page.getByPlaceholder("Team name").fill("Field Sales");
  await page.getByLabel("Org unit").selectOption("Marketing");
  await page.getByLabel("Country").selectOption("FR");
  await page.getByRole("button", { name: "Ask for this team" }).click();
  await expect(page.getByText("Waiting for an admin to approve Field Sales.")).toBeVisible();
});

test("admins approve new teams, and file work for any owner", async ({ page }) => {
  await signIn(page, "alice");
  await page.goto("/?view=admin&tab=teams");
  const pending = page.locator("section", { hasText: "New teams waiting for approval" });
  await expect(pending.getByText("Customer Support Tools")).toBeVisible();
  await expect(pending.getByText(/asked for by Mia Lopez/)).toBeVisible();

  // No team of her own: she picks the owner, and it goes to their team.
  await page
    .locator("aside")
    .getByRole("button", { name: /New initiative/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "New initiative" });
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Login risk alerts");
  await dialog.getByLabel("Summary").fill("Alert the security team about risky logins.");
  await dialog.getByRole("combobox", { name: "Owner" }).click();
  await dialog.getByRole("combobox", { name: "Owner" }).fill("omar");
  await dialog.getByRole("option", { name: /Omar Haddad/ }).click();
  await expect(dialog.getByText(/Filed under Identity & Security/)).toBeVisible();

  // Tags come from the ones in use.
  const tags = dialog.getByRole("combobox", { name: "Tags" });
  await tags.fill("secur");
  await dialog.getByRole("option", { name: "#security" }).click();
  await expect(dialog.getByText("#security", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Create initiative" }).click();
  await expect(page.getByText(/Created Login risk alerts/)).toBeVisible();
});
