import { connectDemoLlm, resetDemo } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
});

test("the answer streams in, then names the team and contact", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=chat");
  await page
    .getByRole("button", { name: /Passwordless login for customers using passkeys/ })
    .click();
  // Partial text is on screen before the evidence cards (which arrive with the saved message).
  await expect(page.getByText(/^This looks like/).first()).toBeVisible();
  await expect(page.getByText(/talk to Omar Haddad/)).toBeVisible({ timeout: 20_000 });
  // A likely duplicate: the agent doesn't offer to register it.
  await expect(page.getByText(/Evidence · \d/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Register/ })).toHaveCount(0);
});

test("small talk gets a reply; Register appears once there's an idea", async ({ page }) => {
  await signIn(page, "sam");
  await page.goto("/?view=chat");
  const composer = page.getByPlaceholder("Describe an idea…");
  await composer.fill("Hi");
  await composer.press("Enter");
  await expect(page.getByText(/Describe your idea or the work you have in mind/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Register this idea" })).toHaveCount(0);
  await expect(page.getByText(/^Searched for/)).toHaveCount(0);

  await composer.fill("Carbon footprint reporting for business customers");
  await composer.press("Enter");
  await expect(
    page.getByText("Searched for “Carbon footprint reporting for business customers.”"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Register this idea" })).toBeVisible();

  // The offer belongs to that reply: moving on takes it away.
  await composer.fill("thanks");
  await composer.press("Enter");
  await expect(page.getByText(/You're welcome/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Register this idea" })).toHaveCount(0);
});

test("a vague idea isn't offered for registering until the person asks", async ({ page }) => {
  await signIn(page, "lena");
  await page.goto("/?view=chat");
  const composer = page.getByPlaceholder("Describe an idea…");
  await composer.fill("office plant watering");
  await composer.press("Enter");
  // Shown with the saved reply, so the composer takes the next message.
  await expect(page.getByText("Searched for “office plant watering.”")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/what would change, and for whom/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Register this idea" })).toHaveCount(0);

  await composer.fill("nah, I just want to go ahead with it");
  await composer.press("Enter");
  await expect(page.getByText(/use the Register button below/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Nothing similar found")).toBeVisible();
  await page.getByRole("button", { name: "Register this idea" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("input").first()).toHaveValue("Office plant watering", {
    timeout: 20_000,
  });
  // "Go ahead" isn't part of the idea.
  await expect(dialog.getByLabel("Summary")).toHaveValue(/plant watering/i);
  await expect(dialog.getByLabel("Summary")).not.toHaveValue(/go ahead/i);
});

test("no match → draft → register", async ({ page }) => {
  await signIn(page, "dan");
  await page.goto("/?view=chat");
  await page.getByRole("button", { name: /Carbon footprint reporting/ }).click();
  await expect(page.getByText("Nothing similar found")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Register this idea" }).click();
  await expect(page.getByText("Drafted by Scry from your conversation.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("dialog").locator("input").first()).toHaveValue(/carbon footprint/i);
  // Dan is his team's only member, so he's the contact without a dropdown.
  await expect(page.getByRole("combobox", { name: "Contact person" })).toHaveCount(0);
  await expect(page.getByRole("dialog").getByText("Daniel Kim", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Register initiative" }).click();
  await expect(page.getByText(/Registered as “Carbon footprint reporting/)).toBeVisible();
});

test("a stuck draft can be skipped, starting from the user's own words", async ({ page }) => {
  // Hold the draft open, as a slow or stuck model would.
  await page.route("**/chat/sessions/*/draft", () => {});
  // Priya's seeded conversation found nothing and hasn't been registered.
  await signIn(page, "priya");
  await page.goto("/?view=chat");
  await page.getByRole("button", { name: /Data contracts for event schemas/ }).click();
  await page.getByRole("button", { name: "Register this idea" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Drafting from your conversation…")).toBeVisible();
  await dialog.getByRole("button", { name: "Skip, I'll write it" }).click();
  await expect(dialog.getByText("Started from your own words.")).toBeVisible();
  await expect(dialog.locator("input").first()).toHaveValue(/data contracts/i);
});
