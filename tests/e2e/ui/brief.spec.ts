import { as, connectDemoLlm, resetDemo } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
});

test("the brief says what needs a decision, and can be reworded by AI", async ({ page }) => {
  await signIn(page, "priya");
  await page.goto("/");
  await page.locator("aside nav").getByRole("button", { name: "Brief" }).click();
  const brief = page.getByRole("article", { name: /Portfolio brief/ });
  await expect(brief.getByRole("heading", { name: "Whole organisation" })).toBeVisible();

  // The summary and the decisions are computed without AI.
  await expect(brief.getByText("Written by Scry from the figures below.")).toBeVisible();
  const decisions = brief.locator("section", { hasText: "Decisions for you" });
  await expect(decisions.getByRole("listitem").first()).toContainText(
    "look like the same work, 87% similar. Talk to Bob Martinez and Priya Shah.",
  );
  const wanted = brief.locator("section", { hasText: "Most wanted" });
  await expect(wanted.getByText("Nobody has committed").first()).toBeVisible();
  await expect(wanted.getByText(/not confirmed since, so not counted/)).toBeVisible();
  await expect(brief.getByText("3 teams, separately")).toBeVisible();

  // The AI rewording cites initiatives from the brief, and they open.
  await page.getByRole("button", { name: "Reword with AI" }).click();
  await expect(
    page.getByText("Reworded by AI from the figures in this brief. Check it before you share it."),
  ).toBeVisible();
  await expect(
    brief.getByText("Growth and Data & ML may be building the same thing."),
  ).toBeVisible();
  await brief.getByTitle("Open “Dark mode everywhere”").first().click();
  await expect(page).toHaveURL(/i=/);
  await page.getByRole("button", { name: "Use the plain summary" }).click();
  await expect(brief.getByText("Written by Scry from the figures below.")).toBeVisible();
});

test("period and scope live in the URL", async ({ page }) => {
  await signIn(page, "priya");
  await page.goto("/?view=brief");
  await page.getByRole("radio", { name: "All time" }).click();
  await expect(page).toHaveURL(/days=0/);
  await expect(page.getByText(/^All time · /)).toBeVisible();
  await page.getByLabel("Scope").selectOption("Security");
  await expect(page).toHaveURL(/unit=Security/);
  await expect(page.getByRole("heading", { name: "Security", level: 1 })).toBeVisible();
});

test("copy as text gives a paste-ready brief", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "priya");
  await page.goto("/?view=brief");
  await page.getByRole("button", { name: "Copy as text" }).click();
  await expect(page.getByText(/Copied as text/)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Portfolio brief: Whole organisation, the last 90 days/);
  expect(text).toContain(
    "Decisions for you\n1. Possible duplicate: “Customer analytics dashboards for account managers”",
  );
  expect(text).toContain("Most wanted\n- Dark mode everywhere (Design Systems, idea): 2 teams.");
});

test("works without an AI model", async ({ page }) => {
  await (await as("alice")).call("DELETE", "/admin/llm");
  await signIn(page, "priya");
  await page.goto("/?view=brief");
  // The summary is still there; only the AI rewording is gone.
  await expect(page.getByText("Written by Scry from the figures below.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reword with AI" })).toHaveCount(0);
  await expect(page.getByText("Decisions for you")).toBeVisible();
  await connectDemoLlm();
});
