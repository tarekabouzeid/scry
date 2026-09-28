import { describe, expect, it, vi } from "vitest";
import {
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  ToolError,
  handleBody,
  handleMessage,
  negotiateVersion,
  type ServerContext,
} from "./mcp-protocol";
import { TOOLS } from "./mcp-tools";

function ctx(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    name: "scry",
    title: "Scry",
    version: "0.1.0",
    instructions: "Read-only.",
    tools: TOOLS,
    call: async () => ({ data: { results: [{ id: "a" }] }, ids: ["a"] }),
    ...overrides,
  };
}

describe("handleMessage", () => {
  it("initializes with a version both sides speak", async () => {
    const r = await handleMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      ctx(),
    );
    expect(r).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "scry" },
      },
    });
    expect(negotiateVersion("1999-01-01")).toBe("2025-06-18");
  });

  it("lists read-only tools", async () => {
    const r = await handleMessage({ jsonrpc: "2.0", id: "x", method: "tools/list" }, ctx());
    const tools = (r as unknown as { result: { tools: typeof TOOLS } }).result.tools;
    expect(tools.map((t) => t.name)).toContain("search_initiatives");
    for (const t of tools) expect(t.annotations.readOnlyHint).toBe(true);
  });

  it("calls a tool, returns text and structured content, and logs it", async () => {
    const onCall = vi.fn();
    const r = await handleMessage(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_teams", arguments: {} },
      },
      ctx({ onCall }),
    );
    expect(r).toMatchObject({
      result: { isError: false, structuredContent: { results: [{ id: "a" }] } },
    });
    expect(onCall).toHaveBeenCalledWith({ tool: "list_teams", args: {}, ids: ["a"], ok: true });
  });

  it("reports fixable problems as tool errors, and hides unexpected ones", async () => {
    const onError = vi.fn();
    const fixable = await handleMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_teams" } },
      ctx({
        call: async () => {
          throw new ToolError("No team is called X");
        },
      }),
    );
    expect(fixable).toMatchObject({
      result: { isError: true, content: [{ type: "text", text: "No team is called X" }] },
    });
    const crash = await handleMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_teams" } },
      ctx({
        call: async () => {
          throw new Error("connection refused at 10.0.0.3");
        },
        onError,
      }),
    );
    expect(JSON.stringify(crash)).not.toContain("10.0.0.3");
    expect(onError).toHaveBeenCalled();
  });

  it("rejects unknown tools and methods, and bad requests", async () => {
    expect(
      await handleMessage(
        { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "delete_everything" } },
        ctx(),
      ),
    ).toMatchObject({ error: { code: INVALID_PARAMS } });
    expect(
      await handleMessage({ jsonrpc: "2.0", id: 6, method: "resources/list" }, ctx()),
    ).toMatchObject({ error: { code: METHOD_NOT_FOUND } });
    expect(await handleMessage({ id: 7, method: "ping" }, ctx())).toMatchObject({
      error: { code: INVALID_REQUEST },
    });
    expect(await handleMessage("hello", ctx())).toMatchObject({ error: { code: INVALID_REQUEST } });
  });

  it("answers notifications with nothing", async () => {
    expect(
      await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx()),
    ).toBeNull();
  });
});

describe("handleBody", () => {
  it("answers a batch, skipping notifications", async () => {
    const r = await handleBody(
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 1, method: "ping" },
      ],
      ctx(),
    );
    expect(r).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    expect(await handleBody([{ jsonrpc: "2.0", method: "notifications/x" }], ctx())).toBeNull();
  });
});
