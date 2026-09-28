import { describe, expect, it } from "vitest";
import { isAllowedRedirectUri, redirectMatches } from "./mcp-config";
import { safeReturnPath } from "../auth/auth.controller";

describe("redirect URIs an AI tool may register", () => {
  it("allows https, loopback http and app schemes", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:53112/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:8080/cb")).toBe(true);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(true);
  });
  it("refuses plain http elsewhere, script-ish schemes and fragments", () => {
    expect(isAllowedRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,hi")).toBe(false);
    expect(isAllowedRedirectUri("https://ok.example/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });
  it("matches exactly, except any port on loopback", () => {
    const registered = ["http://localhost:1234/callback", "https://app.example/cb"];
    expect(redirectMatches(registered, "http://localhost:9999/callback")).toBe(true);
    expect(redirectMatches(registered, "http://localhost:9999/other")).toBe(false);
    expect(redirectMatches(registered, "https://app.example/cb")).toBe(true);
    expect(redirectMatches(registered, "https://app.example/cb2")).toBe(false);
    expect(redirectMatches(registered, "http://127.0.0.1:1234/callback")).toBe(false);
  });
});

describe("safeReturnPath", () => {
  it("keeps paths in the web app and drops anything else", () => {
    expect(safeReturnPath("/connect?request=abc")).toBe("/connect?request=abc");
    expect(safeReturnPath("//evil.example/x")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });
});
