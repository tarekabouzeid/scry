import { beforeAll, describe, expect, it } from "vitest";
import { as, connectDemoLlm, initiativeId, resetDemo } from "../support/scry";

beforeAll(async () => {
  await resetDemo();
  await connectDemoLlm();
});

describe("similar work while drafting", () => {
  it("flags an idea that already exists", async () => {
    const passkeys = await initiativeId("Passkeys for customer login");
    const q = encodeURIComponent("Passwordless login for customers using passkeys");
    const { status, data } = await (await as("bob")).call("GET", `/search/similar?q=${q}`);
    expect(status).toBe(200);
    expect(data[0]).toMatchObject({ initiative: { id: passkeys }, strength: "strong" });
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it("stays quiet for something new", async () => {
    const q = encodeURIComponent("Office plant watering rota for the Lisbon site");
    const { data } = await (await as("bob")).call("GET", `/search/similar?q=${q}`);
    expect(data.filter((m: any) => m.strength === "strong")).toHaveLength(0);
  });

  it("needs a few words to go on", async () => {
    expect((await (await as("bob")).call("GET", "/search/similar?q=sso")).status).toBe(400);
  });
});
