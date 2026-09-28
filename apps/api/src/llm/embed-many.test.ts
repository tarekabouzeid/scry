import { describe, expect, it, vi } from "vitest";
import { EMBED_BATCH_SIZE, LlmService } from "./llm.service";
import { defaultSettings } from "./llm-settings.schema";

// Stand in for the AI SDK (vi.mock is hoisted above the imports): each
// request returns one vector per text.
const requests: string[][] = vi.hoisted(() => []);
vi.mock("ai", async (actual) => ({
  ...(await actual<typeof import("ai")>()),
  embedMany: vi.fn(async ({ values }: { values: string[] }) => {
    requests.push(values);
    return {
      embeddings: values.map((v) => (v === "short" ? [1, 2] : [1, 2, 3])),
      usage: { tokens: values.length },
    };
  }),
}));

function service() {
  const settings = defaultSettings();
  settings.connection.baseUrl = "http://litellm:4000/v1";
  settings.models.embedding.dimensions = 3;
  const active = { settings, secrets: {}, version: "1", source: "database" };
  const record = vi.fn();
  const llm = new LlmService(
    { active: async () => active } as never,
    { get: () => undefined } as never,
    { record } as never,
  );
  return { llm, record };
}

describe("LlmService.embedMany", () => {
  it("sends at most EMBED_BATCH_SIZE texts per request, records each, keeps order", async () => {
    requests.length = 0;
    const { llm, record } = service();
    const texts = Array.from({ length: EMBED_BATCH_SIZE * 2 + 3 }, (_, n) => `text ${n}`);
    const vectors = await llm.embedMany(texts);
    expect(vectors).toHaveLength(texts.length);
    expect(requests.map((r) => r.length)).toEqual([EMBED_BATCH_SIZE, EMBED_BATCH_SIZE, 3]);
    expect(requests.flat()).toEqual(texts);
    expect(record).toHaveBeenCalledTimes(3);
    expect(record.mock.calls[0]![0]).toMatchObject({ role: "embedding", ok: true });
  });

  it("refuses vectors of the wrong size", async () => {
    const { llm, record } = service();
    await expect(llm.embedMany(["fine", "short"])).rejects.toThrow();
    expect(record.mock.calls[0]![0]).toMatchObject({ ok: false });
  });
});
