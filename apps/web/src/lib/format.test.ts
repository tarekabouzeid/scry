import { describe, expect, it } from "vitest";
import { formatDateTime, postedTime } from "./format";

const time = (d: Date) => d.toLocaleTimeString(undefined, { timeStyle: "short" });

describe("postedTime", () => {
  const now = new Date(2026, 8, 26, 18, 0);

  it("shows the time of day for anything posted today", () => {
    const morning = new Date(2026, 8, 26, 9, 5);
    expect(postedTime(morning.toISOString(), now)).toBe(`today at ${time(morning)}`);
    const justNow = new Date(2026, 8, 26, 17, 59);
    expect(postedTime(justNow.toISOString(), now)).toBe(`today at ${time(justNow)}`);
  });

  it("falls back to relative wording before today", () => {
    const lastWeek = new Date(2026, 8, 19, 12, 0);
    expect(postedTime(lastWeek.toISOString(), now)).not.toMatch(/^today/);
  });
});

describe("formatDateTime", () => {
  it("includes the date and the time", () => {
    const at = new Date(2026, 8, 25, 14, 32);
    const text = formatDateTime(at.toISOString());
    expect(text).toContain("2026");
    expect(text).toContain(time(at));
  });
});
