import { resetDemo, sql, userRow } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

// The web app never loads every initiative: lists page through the api,
// the board reads one lane at a time and the graph opens one team at a time.

test.beforeEach(async () => {
  await resetDemo();
});

/** Enough extra ideas in bob's team to need a second page (pages are 50). */
async function addFiller(count: number) {
  const bob = await userRow("bob");
  await sql`
    insert into initiatives (title, summary, status, team_id, submitted_by, contact_person, updated_at)
    select 'Filler idea ' || lpad(g::text, 3, '0'), 'Padding for paging tests.', 'idea',
           ${bob.team_id}, ${bob.id}, ${bob.id}, now() - make_interval(days => 400 + g)
    from generate_series(1, ${count}) g`;
}

test("table: the four sortable columns sort in the api, the rest don't", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/");
  const header = (name: string) => page.getByRole("columnheader", { name });

  await expect(header("Updated")).toHaveAttribute("aria-sort", "descending");
  await expect(header("Team").getByRole("button")).toHaveCount(0);
  await expect(header("Tier").getByRole("button")).toHaveCount(0);

  await header("Initiative").getByRole("button").click();
  await expect(page).toHaveURL(/sort=title/);
  await expect(header("Initiative")).toHaveAttribute("aria-sort", "ascending");
  const titles = async () =>
    (await page.locator("tbody tr td:first-child p:first-child span:first-child").allTextContents())
      .map((t) => t.trim())
      .filter(Boolean);
  await expect.poll(async () => (await titles()).length).toBeGreaterThan(5);
  const asc = await titles();
  expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));

  await header("Initiative").getByRole("button").click();
  await expect(page).toHaveURL(/dir=desc/);
  await expect(header("Initiative")).toHaveAttribute("aria-sort", "descending");
  await expect.poll(async () => (await titles())[0]).toBe(asc.at(-1));

  // A sorted view is a link: it survives a reload.
  await page.reload();
  await expect(header("Initiative")).toHaveAttribute("aria-sort", "descending");
  await header("Status").getByRole("button").click();
  await expect(page).toHaveURL(/sort=status/);
});

test("table: a long list loads 50 at a time", async ({ page }) => {
  await addFiller(60);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from initiatives`;
  await signIn(page, "bob");
  await page.goto("/");
  await expect(page.getByText(`${n} results`)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await expect(page.getByText(`Showing 50 of ${n}`)).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(n);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  // The cards still count everything.
  await expect(page.getByText("Total initiatives").locator("..").locator("..")).toContainText(
    String(n),
  );
});

test("board: a full lane shows more on request", async ({ page }) => {
  await addFiller(60);
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from initiatives where status = 'idea'`;
  await signIn(page, "bob");
  await page.goto("/?view=kanban");
  const ideas = page.locator('section[aria-label="Idea"]');
  await expect(ideas.locator("header")).toContainText(String(n));
  await expect(ideas.locator("[data-initiative]")).toHaveCount(50);
  await ideas.getByRole("button", { name: /Show more/ }).click();
  await expect(ideas.locator("[data-initiative]")).toHaveCount(n);
});

test("command palette searches the api", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/");
  await page.getByRole("button", { name: /Jump to/ }).click();
  await page.getByPlaceholder(/Jump to an initiative/).fill("passkeys customer");
  const option = page.getByRole("option", { name: /Passkeys for customer login/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(
    page.getByRole("complementary", { name: "Initiative details" }).getByRole("heading", {
      name: "Passkeys for customer login",
    }),
  ).toBeVisible();
});

test("graph: the organisation by team, opening teams as you zoom in", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=graph");
  // No starting point to pick: the whole organisation is on the map.
  const status = page.getByRole("status").filter({ hasText: "on the map" });
  await expect(status).toHaveText(/\d+ teams on the map/);
  await expect(page.locator("canvas").first()).toBeVisible();

  const bob = await userRow("bob");
  await page.getByLabel("Go to a team").selectOption(bob.team_id!);
  await expect(page).toHaveURL(new RegExp(`team=${bob.team_id}`));
  // Going to a team zooms in far enough to open it.
  await expect(status).toHaveText(/[1-9]\d* open, [1-9]\d* initiatives? shown/);

  await page.getByLabel("Go to an initiative").fill("Referral");
  await page.getByRole("option", { name: /Referral program v2/ }).click();
  await expect(page).toHaveURL(/i=/);
  await expect(
    page.getByRole("complementary", { name: "Initiative details" }).getByRole("heading", {
      name: "Referral program v2",
    }),
  ).toBeVisible();

  // Closing the details keeps the map where it is.
  await page.keyboard.press("Escape");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await expect(status).toHaveText(/\d+ teams on the map/);
});
