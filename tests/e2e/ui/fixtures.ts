import { test as base, expect, type Page } from "@playwright/test";
import { sessionFor, type Person } from "../support/scry";

/** Sign a page in as a demo user by setting the session cookie (no IdP needed). */
export async function signIn(page: Page, person: Person) {
  const { token } = await sessionFor(person);
  await page
    .context()
    .addCookies([{ name: "scry_session", value: token, domain: "localhost", path: "/" }]);
}

/** Fails a test on any uncaught error in the page. */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await use(page);
    expect(errors, "uncaught page errors").toEqual([]);
  },
});

export { expect };
