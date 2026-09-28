import { resetDemo, sql, userRow, waitFor } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeEach(async () => {
  await resetDemo();
});

async function statusOf(id: string) {
  const [row] = await sql<{ status: string }[]>`select status from initiatives where id = ${id}`;
  return row!.status;
}

test("board: drag a card you own to another lane, undo, and move with the keyboard", async ({
  page,
}) => {
  const bob = await userRow("bob");
  const [mine] = await sql<{ id: string; status: string }[]>`
    select id, status from initiatives
    where (submitted_by = ${bob.id} or contact_person = ${bob.id}) and status = 'idea' limit 1`;
  const [theirs] = await sql<{ id: string }[]>`
    select id from initiatives
    where submitted_by <> ${bob.id} and contact_person is distinct from ${bob.id} limit 1`;

  await signIn(page, "bob");
  await page.goto("/?view=kanban");
  const card = page.locator(`[data-initiative="${mine!.id}"]`);
  await expect(page.locator(`[data-initiative="${theirs!.id}"]`)).toHaveAttribute(
    "draggable",
    "false",
  );

  await card.dragTo(page.locator('section[aria-label="Planned"]'));
  await waitFor(async () => (await statusOf(mine!.id)) === "planned", "status saved");
  await expect(page.locator('section[aria-label="Planned"]').locator(card)).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await waitFor(async () => (await statusOf(mine!.id)) === "idea", "undo saved");

  await card.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await waitFor(async () => (await statusOf(mine!.id)) === "planned", "keyboard move saved");
  await expect(card).toBeFocused();
});

test("board: a card moves back after the table was open (no stale copy)", async ({ page }) => {
  const bob = await userRow("bob");
  const [mine] = await sql<{ id: string }[]>`
    select id from initiatives
    where (submitted_by = ${bob.id} or contact_person = ${bob.id}) and status = 'idea' limit 1`;

  await signIn(page, "bob");
  await page.goto("/");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  // Switch in the app, so the table's list stays cached (and goes stale).
  await page.locator("aside nav").getByRole("button", { name: "Board" }).click();
  const card = page.locator(`[data-initiative="${mine!.id}"]`);

  await card.dragTo(page.locator('section[aria-label="Planned"]'));
  await waitFor(async () => (await statusOf(mine!.id)) === "planned", "moved to planned");
  await expect(page.locator('section[aria-label="Planned"]').locator(card)).toBeVisible();

  await card.dragTo(page.locator('section[aria-label="Idea"]'));
  await waitFor(async () => (await statusOf(mine!.id)) === "idea", "moved back to idea");
  await expect(page.locator('section[aria-label="Idea"]').locator(card)).toBeVisible();
});

test("saved views and row density", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?status=on_hold");
  await page.getByRole("button", { name: "Views" }).click();
  await page.getByLabel("View name").fill("On hold");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.keyboard.press("Escape");

  await page.goto("/?view=graph");
  await page.locator("aside nav").getByRole("button", { name: "On hold" }).click();
  await expect(page).toHaveURL(/status=on_hold/);
  await expect(page.getByRole("button", { name: "On hold" })).toHaveCount(2);

  await page.getByRole("button", { name: "Compact rows" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Comfortable rows" })).toBeVisible();
});

test("details panel resizes and remembers its width", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/");
  await page.locator("tbody tr").first().click();
  const panel = page.getByRole("complementary", { name: "Initiative details" });
  const before = (await panel.boundingBox())!.width;
  const handle = (await page
    .getByRole("separator", { name: "Resize details panel" })
    .boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(handle.x - 200, 400, { steps: 8 });
  await page.mouse.up();
  const after = (await panel.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 150);
  await page.reload();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(after, 0);
});

test("admin setup checklist tracks progress and can be hidden", async ({ page }) => {
  await signIn(page, "alice");
  await page.goto("/?view=admin");
  const checklist = page.getByRole("region", { name: "Setup checklist" });
  await expect(checklist.getByText("Connect an AI model")).toBeVisible();
  await checklist.getByRole("button", { name: "Set up AI" }).click();
  await expect(page).toHaveURL(/tab=ai/);
  await checklist.getByRole("button", { name: "Hide" }).click();
  await expect(checklist).toHaveCount(0);
});
