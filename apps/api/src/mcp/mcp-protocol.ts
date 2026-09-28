// The MCP wire protocol, as much of it as a stateless, tools-only server
// needs: JSON-RPC 2.0 over Streamable HTTP, answered with plain JSON (never
// an SSE stream), no sessions. Pure, so it's unit-tested without the api.
//
// Spec: https://modelcontextprotocol.io/specification/2025-06-18

/** Newest first; an unknown version from the client gets the newest. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
}

/** What a tool returns: the data, and the initiative ids in it (for the usage log). */
export interface ToolOutput {
  data: Record<string, unknown>;
  ids: string[];
}

/**
 * A problem the caller can fix (bad arguments, nothing found, AI not set up).
 * Reported to the model as a tool result with `isError`, so it can adapt,
 * rather than as a protocol error.
 */
export class ToolError extends Error {}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string };
}
export interface JsonRpcResult {
  jsonrpc: "2.0";
  id: string | number;
  result: Record<string, unknown>;
}
export type JsonRpcResponse = JsonRpcResult | JsonRpcError;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

export interface ServerContext {
  name: string;
  title: string;
  version: string;
  instructions: string;
  tools: ToolDefinition[];
  /** Runs a tool; throws ToolError for problems the caller can fix. */
  call: (name: string, args: Record<string, unknown>) => Promise<ToolOutput>;
  /** Called once per tools/call, whatever happened (the usage log). */
  onCall?: (call: {
    tool: string;
    args: Record<string, unknown>;
    ids: string[];
    ok: boolean;
  }) => void;
  /** Unexpected failures, for the server log (never sent to the client). */
  onError?: (err: unknown) => void;
}

function error(id: JsonRpcError["id"], code: number, message: string): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isId(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0];
}

/**
 * One JSON-RPC message in, one response out, or null for a notification
 * (no id), which gets no response.
 */
export async function handleMessage(
  message: unknown,
  ctx: ServerContext,
): Promise<JsonRpcResponse | null> {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return error(null, INVALID_REQUEST, "Expected a JSON-RPC request object");
  }
  const msg = message as Record<string, unknown>;
  const hasId = "id" in msg && msg.id !== undefined;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string" || (hasId && !isId(msg.id))) {
    return error(isId(msg.id) ? msg.id : null, INVALID_REQUEST, "Invalid JSON-RPC request");
  }
  // Notifications (initialized, cancelled…) need nothing from a stateless server.
  if (!hasId) return null;
  const id = msg.id as string | number;
  const params =
    typeof msg.params === "object" && msg.params !== null && !Array.isArray(msg.params)
      ? (msg.params as Record<string, unknown>)
      : {};

  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: ctx.name, title: ctx.title, version: ctx.version },
          instructions: ctx.instructions,
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: ctx.tools } };
    case "tools/call": {
      const name = params.name;
      const tool = ctx.tools.find((t) => t.name === name);
      if (typeof name !== "string" || !tool) {
        return error(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      }
      const args =
        typeof params.arguments === "object" &&
        params.arguments !== null &&
        !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const out = await ctx.call(name, args);
        ctx.onCall?.({ tool: name, args, ids: out.ids, ok: true });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(out.data, null, 2) }],
            structuredContent: out.data,
            isError: false,
          },
        };
      } catch (err) {
        ctx.onCall?.({ tool: name, args, ids: [], ok: false });
        if (!(err instanceof ToolError)) ctx.onError?.(err);
        const text =
          err instanceof ToolError ? err.message : "Scry couldn't answer that; try again later.";
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text }], isError: true },
        };
      }
    }
    default:
      return error(id, METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

/**
 * A POST body: one message, or (2025-03-26) a batch. Returns what to send:
 * a response, an array of them, or null when everything was a notification
 * (HTTP 202 with no body).
 */
export async function handleBody(
  body: unknown,
  ctx: ServerContext,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return error(null, INVALID_REQUEST, "Empty batch");
    const out: JsonRpcResponse[] = [];
    for (const message of body) {
      const response = await handleMessage(message, ctx);
      if (response) out.push(response);
    }
    return out.length ? out : null;
  }
  return handleMessage(body, ctx);
}
