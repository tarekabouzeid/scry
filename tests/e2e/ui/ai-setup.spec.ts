import { env } from "../support/env";
import { resetDemo } from "../support/scry";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
});

test("before setup, members are told AI is off and everything else works", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=chat");
  await expect(page.getByText("An admin can connect one in Admin → AI & models.")).toBeVisible();
  await expect(page.getByPlaceholder("Describe an idea…")).toBeHidden();
  await page.goto("/?view=graph");
  await expect(page.getByPlaceholder("Semantic search needs an AI model")).toBeDisabled();
  await page.goto("/?q=passkeys");
  await page.getByText("Passkeys for customer login").first().click();
  await expect(page.getByText("Not indexed")).toBeVisible();
  await expect(page.getByText("No AI model connected.")).toHaveCount(0); // admins only
});

test("an admin connects the model: test, save, index", async ({ page }) => {
  await signIn(page, "alice");
  await page.goto("/");
  await expect(page.getByText("No AI model connected.")).toBeVisible();
  await page.getByRole("button", { name: "Set up AI" }).click();
  await expect(page).toHaveURL(/tab=ai/);
  await expect(page.getByText("Not configured", { exact: true })).toBeVisible();

  await page.getByPlaceholder("http://litellm:4000/v1").fill(env.llmUrl);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("1536-dimensional vectors")).toBeVisible();
  await expect(page.getByText("Structured output works")).toHaveCount(2);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved — indexing 22 initiatives/)).toBeVisible();
  await expect(page.getByText("Configured here")).toBeVisible();
  await expect(page.getByText("22/22")).toBeVisible({ timeout: 30_000 });

  await page.goto("/");
  await expect(page.getByText("Every initiative across every team")).toBeVisible();
  await expect(page.getByText("No AI model connected.")).toHaveCount(0);
});

test("JWT signed by Scry: key, JWKS URL, LiteLLM snippet; unsaved edits survive rotation", async ({
  page,
}) => {
  await signIn(page, "alice");
  await page.goto("/?view=admin&tab=ai");
  await page.getByRole("radio", { name: /JWT signed by Scry/ }).click();
  await expect(page.getByLabel("Audience (aud)")).toHaveValue("litellm");
  await page.getByRole("button", { name: "Generate key" }).click();
  await expect(page.getByText("New signing key published")).toBeVisible();
  // The mode switch wasn't saved, and generating a key mustn't wipe it.
  await expect(page.getByRole("radio", { name: /JWT signed by Scry/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByText(`${env.apiUrl}/.well-known/jwks.json`).first()).toBeVisible();
  await page.getByText("LiteLLM setup").click();
  await expect(page.getByText(/JWT_PUBLIC_KEY_URL=/)).toBeVisible();

  // Switching back hides the JWT fields again (nothing was saved).
  await page.getByRole("radio", { name: /No authentication/ }).click();
  await expect(page.getByLabel("Audience (aud)")).toHaveCount(0);
});

test("Test connection offers the model's real vector size", async ({ page }) => {
  await signIn(page, "alice");
  await page.goto("/?view=admin&tab=ai");
  await page.getByPlaceholder("http://litellm:4000/v1").fill(env.llmUrl);
  await page.getByLabel("Embeddings model").fill("demo-embed-768");
  await page.getByRole("button", { name: "Test connection" }).click();
  await page.getByRole("button", { name: "Use 768 dimensions" }).click();
  await expect(page.getByLabel("Dimensions")).toHaveValue("768");
  await expect(page.getByText(/saving re-indexes every initiative/)).toBeVisible();
});
