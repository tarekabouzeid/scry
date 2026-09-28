import { createHash, randomBytes } from "node:crypto";
import { as, resetDemo } from "../support/scry";
import { env } from "../support/env";
import { expect, signIn, test } from "./fixtures";

test.beforeAll(async () => {
  await resetDemo();
});

/** Register a tool and start its authorization; returns the consent page's URL. */
async function consentUrl(name: string) {
  const redirectUri = "http://localhost:8765/callback";
  const client = await (
    await fetch(`${env.apiUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: name, redirect_uris: [redirectUri] }),
    })
  ).json();
  const verifier = randomBytes(32).toString("base64url");
  const res = await fetch(
    `${env.apiUrl}/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "s1",
    })}`,
    { redirect: "manual" },
  );
  return res.headers.get("location")!;
}

test("an admin turns on AI tools, and sees who uses them", async ({ page }) => {
  await signIn(page, "alice");
  await page.goto("/?view=admin&tab=mcp");
  await expect(page.getByText("Connecting AI tools (MCP)")).toBeVisible();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();
  await expect(page.getByText("Nobody has asked Scry from an AI tool yet.")).toBeVisible();
});

test("someone connects an AI tool from the consent page", async ({ page }) => {
  const url = await consentUrl("Claude Code");
  // Signed out, the page asks to sign in and comes back here afterwards.
  await page.goto(url);
  const login = page.waitForRequest((r) => r.url().includes("/auth/login?returnTo="));
  await page.getByRole("button", { name: "Continue with SSO" }).click();
  expect(decodeURIComponent((await login).url())).toContain("returnTo=/connect?request=");

  await signIn(page, "bob");
  await page.route("http://localhost:8765/**", (route) =>
    route.fulfill({ status: 200, body: "Connected, you can close this." }),
  );
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Let Claude Code read Scry as you?" }),
  ).toBeVisible();
  await expect(page.getByText("It can't add, change or delete anything.")).toBeVisible();
  await page.getByRole("button", { name: "Allow read access" }).click();
  await page.waitForURL(/localhost:8765\/callback\?code=/);
  expect(new URL(page.url()).searchParams.get("state")).toBe("s1");
});

test("Settings shows how to connect, and the tools connected as you", async ({ page }) => {
  await signIn(page, "bob");
  await page.goto("/?view=settings");
  await expect(
    page.getByText(`claude mcp add --transport http scry ${env.apiUrl}/mcp`),
  ).toBeVisible();
  // The consent above didn't finish its token exchange, so nothing is connected yet.
  await expect(page.getByText("No AI tools yet.")).toBeVisible();
  // New tokens are read only unless asked.
  await expect(page.getByLabel("Token access")).toHaveValue("read");
  await page.getByPlaceholder("e.g. work laptop").fill("agent");
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByText("Copy your token now")).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "agent" }).getByText("Read only", { exact: true }),
  ).toBeVisible();
  const bob = await as("bob");
  const tokens = (await bob.call("GET", "/auth/pat")).data;
  expect(tokens.find((t: { name: string }) => t.name === "agent").scope).toBe("read");
});
