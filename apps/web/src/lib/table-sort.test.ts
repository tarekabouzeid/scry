import { describe, expect, it } from "vitest";
import { nextTableSort, parseTableSort } from "./table-sort";

describe("parseTableSort", () => {
  it("defaults to most recently updated first", () => {
    expect(parseTableSort("", "")).toEqual({ sort: "updated", dir: "desc" });
  });
  it("uses each order's natural direction unless told otherwise", () => {
    expect(parseTableSort("title", "")).toEqual({ sort: "title", dir: "asc" });
    expect(parseTableSort("target", "desc")).toEqual({ sort: "target", dir: "desc" });
  });
  it("ignores orders the api doesn't offer", () => {
    expect(parseTableSort("team", "sideways")).toEqual({ sort: "updated", dir: "desc" });
  });
});

describe("nextTableSort", () => {
  it("starts a new column in its natural direction", () => {
    expect(nextTableSort({ sort: "updated", dir: "desc" }, "title")).toEqual({
      sort: "title",
      dir: "",
    });
    expect(nextTableSort({ sort: "title", dir: "asc" }, "updated")).toEqual({
      sort: "",
      dir: "",
    });
  });
  it("flips the current column", () => {
    expect(nextTableSort({ sort: "title", dir: "asc" }, "title")).toEqual({
      sort: "title",
      dir: "desc",
    });
    expect(nextTableSort({ sort: "updated", dir: "desc" }, "updated")).toEqual({
      sort: "",
      dir: "asc",
    });
  });
});
