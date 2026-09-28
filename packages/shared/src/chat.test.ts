import { describe, expect, it } from "vitest";
import { ideaFromConversation } from "./chat";

describe("ideaFromConversation", () => {
  it("keeps what led to a search and the latest understanding", () => {
    const { said, understood } = ideaFromConversation([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hi! Describe your idea.", searchQuery: null },
      { role: "user", content: "Dashboards for account managers" },
      { role: "assistant", content: "Nothing yet.", searchQuery: "Dashboards for AMs." },
      { role: "user", content: "mainly about churn" },
      { role: "assistant", content: "Still nothing.", searchQuery: "Churn dashboards for AMs." },
      // Doesn't change the idea, so it isn't part of it.
      { role: "user", content: "ok, go ahead" },
      { role: "assistant", content: "Use Register.", searchQuery: "Churn dashboards for AMs." },
    ]);
    expect(said).toEqual(["Dashboards for account managers", "mainly about churn"]);
    expect(understood).toBe("Churn dashboards for AMs.");
  });

  it("falls back to everything the person said when nothing was searched", () => {
    const { said, understood } = ideaFromConversation([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hi!", searchQuery: null },
    ]);
    expect(said).toEqual(["Hi"]);
    expect(understood).toBeNull();
  });
});
