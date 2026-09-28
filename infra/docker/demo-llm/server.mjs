// Demo LLM — a tiny, dependency-free, OpenAI-compatible server so the demo
// runs fully offline with no API key. NOT a language model:
//
//   POST /v1/embeddings        deterministic hashed bag-of-words vectors
//                              (1536-d by default; a model name ending
//                              in a size, e.g. "demo-embed-768", gets
//                              that size), L2-normalised — texts that share
//                              vocabulary get high cosine similarity, so
//                              semantic search, Ask Scry and overlap
//                              detection all behave plausibly on demo data.
//   POST /v1/chat/completions  answers the two structured-output calls the
//                              api makes (agent reply, initiative draft) by
//                              reading the prompt Scry built — templated
//                              prose, no generation.
//
// Connect it in Scry under Admin → AI & models (base URL
// http://demo-llm:4010/v1 in Docker, http://localhost:4010/v1 natively).
// Run natively with `node infra/docker/demo-llm/server.mjs` (port 4010).
//
// Auth is off by default. To try Scry's auth modes against it, set either or
// both (then every /v1 request must pass one of them):
//   DEMO_LLM_API_KEY=<key>         accept "Authorization: Bearer <key>"
//   DEMO_LLM_JWKS_URL=<url>[,<url>] accept RS256 JWTs whose key is in one of
//                                   these JWKS (e.g. Scry's own
//                                   /.well-known/jwks.json, or Keycloak's certs)
//   DEMO_LLM_JWT_AUDIENCE=<aud>    optionally also require this audience
import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 4010);
const DIMENSIONS = 1536;
const STOP = new Set(
  (
    "a an the and or of to for in on at by with from into over under our your their my we you they " +
    "it its is are be been was were this that these those so as can could should would will just " +
    "all any every each more most some such than then there here also only own new build want need " +
    "make let lets using use via across without within about"
  ).split(/\s+/),
);

// Light stemming so "dashboard"/"dashboards" and "manager"/"managers" match.
function stem(word) {
  return word.length > 4 ? word.replace(/(ies|es|s|ing|ed)$/, "") : word;
}

function tokens(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

function hash(word, size) {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % size;
}

export function embed(text, size = DIMENSIONS) {
  const v = new Array(size).fill(0);
  for (const w of tokens(text)) v[hash(w, size)] += 1;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

// ---------- Ask Scry: a small, deterministic tool-using agent ----------
//
// Scry's agent (apps/api/src/chat) sends the conversation plus three tools.
// Each request is one step: we either call a tool or answer, from the
// messages so far, the way a real model would.

function contactName(contact) {
  return contact && contact !== "unknown" ? contact.replace(/\s*<.*>/, "") : null;
}

// Small talk and questions about Scry, rather than an idea to check.
const SMALL_TALK =
  /^(hi|hello|hey|hiya|good (morning|afternoon|evening)|thanks|thank you|cheers|ok|okay|yes|no|who are you|what (can|do) you do|what is scry|how does (this|scry|it) work|help)\b/i;

// About the idea already on the table: going ahead with it, or turning the
// matches down. Neither is a new idea.
const GO_AHEAD = /\b(register|proceed|go ahead|create (it|this|my idea)|submit)\b/i;
const NOT_IT = /\b(not what|not it|nope|nah)\b/i;
const WHO = /\b(who|contact|talk to|owner|owns)\b/i;

function looksLikeIdea(text) {
  const t = text.trim().replace(/[?!.]+$/, "");
  return !SMALL_TALK.test(t) && t.split(/\s+/).length >= 3;
}

// A new idea replaces the old one; a follow-up (a question, turning the
// matches down, going ahead) keeps it.
function nextIdea(current, text) {
  const followUp =
    !!current && (/\?$/.test(text.trim()) || GO_AHEAD.test(text) || NOT_IT.test(text));
  return looksLikeIdea(text) && !followUp && !GO_AHEAD.test(text) ? text : current;
}

const asQuery = (idea) => idea.trim().replace(/[.!?]*$/, ".");
const words = (text) => text.trim().split(/\s+/).length;
const textOf = (m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""));

/** What this turn's tool calls returned so far, by tool name. */
function turnResults(messages) {
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  const names = new Map();
  const results = {};
  for (const m of messages.slice(lastUser + 1)) {
    for (const call of m.tool_calls ?? []) names.set(call.id, call.function.name);
    if (m.role === "tool") {
      try {
        results[names.get(m.tool_call_id)] = JSON.parse(textOf(m));
      } catch {
        results[names.get(m.tool_call_id)] = {};
      }
    }
  }
  return results;
}

function candidatesOf(search) {
  return (search?.initiatives ?? []).map((c) => ({
    ...c,
    score: Number(c.foundVia?.match(/score ([\d.]+)/)?.[1] ?? NaN),
    graph: c.foundVia?.startsWith("a relationship"),
    through: c.foundVia?.match(/from "(.*)"/)?.[1],
  }));
}

function reportSearch(search, ready) {
  const candidates = candidatesOf(search);
  const semantic = candidates.filter((c) => !c.graph).sort((a, b) => b.score - a.score);
  const graph = candidates.filter((c) => c.graph);
  const top = semantic[0];

  if (search.classification === "STRONG_MATCH" && top) {
    const who = contactName(top.contact);
    const related = graph[0];
    return (
      `This looks like the same thing as **${top.title}**, owned by ${top.team} (currently ${top.status}). ` +
      `Before registering a new initiative, ${who ? `talk to ${who}` : "reach out to that team"} — ` +
      `joining forces is usually faster than building it twice.` +
      (related
        ? `\n\nAlso related: **${related.title}** is connected to it via ${related.through}.`
        : "")
    );
  }
  if (search.classification === "WEAK_MATCH" && (top || graph.length)) {
    const cited = [...semantic.filter((c) => c.score >= 0.5).slice(0, 2), ...graph.slice(0, 1)];
    const list = (cited.length ? cited : [top ?? graph[0]]).filter(Boolean);
    return (
      `Heads up — ${list.map((c) => `**${c.title}** (${c.team})`).join(" and ")} ` +
      `${list.length > 1 ? "look" : "looks"} related, but it's not a clear duplicate. ` +
      `If your idea is genuinely different, go ahead and register it — then link it to ` +
      `${list.length > 1 ? "them" : "it"} so both teams stay in sync.`
    );
  }
  return ready
    ? "I couldn't find anything similar in any team's initiatives — this looks new. " +
        "Go ahead and register it so other teams can see it."
    : "I couldn't find anything similar yet. Tell me a bit more: what would change, and for whom? " +
        "You can also register it now.";
}

function smallTalk(latest) {
  const hello = /^(hi|hello|hey|hiya|good )/i.test(latest.trim());
  const thanks = /^(thanks|thank you|cheers)/i.test(latest.trim());
  return thanks
    ? "You're welcome. Describe another idea whenever you like, and I'll check it against every team's initiatives."
    : `${hello ? "Hi! " : ""}I check ideas against every team's initiatives, so you can find related work before you register something new. Describe your idea or the work you have in mind in a sentence or two.`;
}

/** One step of Ask Scry: `{ tool, args }` to call a tool, or `{ text }` to answer. */
function agentStep(body) {
  const messages = body.messages ?? [];
  const system = messages
    .filter((m) => m.role === "system")
    .map(textOf)
    .join("\n");
  const latest = textOf(messages.findLast((m) => m.role === "user") ?? {});
  const registered = system.match(/already registered as "(.*?)"/)?.[1];
  const lastSearch = system.match(/You last searched for: "(.*?)"\./)?.[1] ?? "";
  const mentioned = [...system.matchAll(/^- (.+) \(id: (\S+)\)$/gm)].map((m) => ({
    title: m[1],
    id: m[2],
  }));
  const done = turnResults(messages);
  const idea = nextIdea(lastSearch, latest);
  const changed = !!idea && asQuery(idea) !== asQuery(lastSearch || " ");
  const goAhead = GO_AHEAD.test(latest);

  // 1. A new or changed idea: search for it.
  if (changed && !done.search_initiatives) {
    return { tool: "search_initiatives", args: { query: asQuery(idea) } };
  }
  const search = done.search_initiatives;
  const query = search ? asQuery(idea) : lastSearch;
  // 2. Offer to register once it's clear (not over a likely duplicate), or when asked.
  const ready = !!query && (goAhead || words(query) >= 4);
  const wantsOffer =
    !registered &&
    !done.offer_registration &&
    ((search && ready && search.classification !== "STRONG_MATCH") || (goAhead && lastSearch));
  if (wantsOffer) return { tool: "offer_registration", args: {} };
  // 3. A question about something mentioned earlier: look it up.
  if (!search && WHO.test(latest) && mentioned[0] && !done.get_initiative) {
    return { tool: "get_initiative", args: { id: mentioned[0].id } };
  }

  // Answer.
  if (goAhead && registered) {
    return {
      text: `It's already registered as **${registered}**. To register a different idea, start a new chat.`,
    };
  }
  if (goAhead && done.offer_registration?.shown) {
    return {
      text:
        "Go ahead: use the **Register** button below. Scry drafts the form from this " +
        "conversation, and you can edit it before saving.",
    };
  }
  if (search) return { text: reportSearch(search, ready) };
  const found = done.get_initiative;
  if (found?.title) {
    const who = contactName(found.contact);
    return {
      text: `**${found.title}** is owned by ${found.team} (currently ${found.status}). ${who ? `Talk to ${who} about it.` : "Reach out to that team about it."}`,
    };
  }
  if (lastSearch && NOT_IT.test(latest)) {
    return {
      text: "Fair enough. What's different about your idea? A sentence on what would change, and for whom, helps me search again.",
    };
  }
  return { text: smallTalk(latest) };
}

const TITLE_PREFIXES =
  /^(we|i)\s+(want|need|would like|plan|are planning)\s+(to\s+)?(build|create|add|make|have|start)?\s*|^(an?|the)\s+idea\s+(for|to)\s+|^(what about|how about)\s+/i;

function draft(prompt) {
  const said = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1].trim());
  // Prefer the sentence saying what they want, and keep its first clause.
  const intent = said.find((x) => TITLE_PREFIXES.test(x)) ?? said[0] ?? "New initiative";
  const first = intent
    .replace(TITLE_PREFIXES, "")
    .split(/,|\s+so\s+|\s+because\s+/)[0]
    .replace(/^(an?|the)\s+/i, "")
    .replace(/[.!?]+$/, "");
  const title = (first.charAt(0).toUpperCase() + first.slice(1)).slice(0, 80);
  const text = said.join(" ");
  const counts = new Map();
  for (const w of tokens(text)) if (w.length > 3) counts.set(w, (counts.get(w) ?? 0) + 1);
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
  const strategic = /\b(platform|company|org|every team|all teams|strategic|foundation)\b/i.test(
    text,
  );
  return {
    title,
    summary:
      said.length > 0
        ? said
            .map((s) => s.replace(/^./, (c) => c.toUpperCase()).replace(/([^.!?])$/, "$1."))
            .join(" ")
        : "Describe what this is, who it's for and why it matters.",
    tags,
    tier: strategic ? "strategic" : "tactical",
  };
}

// Writing help in the New initiative dialog: a draft from a rough
// description, or a tidied version of what's written, plus whether the
// summary says what / who for / why. Deterministic, like everything here.
function assist(fullPrompt) {
  // Only the author's part: the system prompt has bullet points of its own.
  const at = Math.max(
    fullPrompt.lastIndexOf("What the author wrote"),
    fullPrompt.lastIndexOf("Current draft:"),
  );
  const prompt = at >= 0 ? fullPrompt.slice(at) : fullPrompt;
  const vocabulary = (fullPrompt.match(/^Existing tags in use: (.+)$/m)?.[1] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && t !== "(none yet)");
  const said = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1].trim());
  const text = said.join(" ");
  const words = new Set(tokens(text));
  const known = vocabulary.filter((t) => t.split("-").every((w) => words.has(stem(w))));
  const base = draft(prompt);
  let title = base.title;
  let tags = [...new Set([...known, ...base.tags])].slice(0, 5);
  if (prompt.startsWith("Current draft:")) {
    const current = prompt.match(/^Title: (.+)$/m)?.[1]?.trim();
    if (current && current !== "(none)") title = current.replace(/[.!?]+$/, "");
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const had = (prompt.match(/^Tags: (.+)$/m)?.[1] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && t !== "(none)");
    tags = [...new Set([...had, ...known, ...base.tags])].slice(0, 5);
  }
  return {
    ...base,
    title,
    tags,
    coverage: {
      what: said.length > 0,
      who: /\b(for|customers?|users?|teams?|managers?|merchants?|staff|admins?|developers?|partners?)\b/i.test(
        text,
      ),
      why: /\b(so that|so|because|to reduce|to avoid|to cut|saves?|faster|fewer|less|churn|risk|cost)\b/i.test(
        text,
      ),
    },
  };
}

// An initiative's TL;DR: its summary's first clause, then where it stands.
function tldr(prompt) {
  const field = (name) => prompt.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1]?.trim() ?? "";
  const none = (v) => (!v || v === "none" ? [] : v.split("; "));
  const join = (xs) =>
    xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  // The summary's first sentence, shortened at a clause boundary if long.
  let text = field("Summary")
    .split(/(?<=[.!?])\s/)[0]
    .replace(/[.!?]+$/, "");
  if (text.split(/\s+/).length > 14) {
    const clause = text.split(/,\s|\s(?:so|without|because|replacing|instead of)\s/)[0];
    if (clause.split(/\s+/).length >= 4) text = clause;
  }
  // "on hold (reason)" -> status "on hold", reason "reason".
  const [, status = "", reason] = field("Status").match(/^([^(]+?)(?: \((.+)\))?$/) ?? [];
  const builtOnBy = none(field("Built on by"));
  const asked = none(field("Asked for by"));
  const parts = [];
  const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  if (status === "on hold") parts.push(reason ? `on hold: ${lower(reason)}` : "on hold");
  else if (status && status !== "idea") parts.push(status);
  else if (status === "idea") parts.push("still an idea");
  if (builtOnBy.length)
    parts.push(`${join(builtOnBy)} ${builtOnBy.length === 1 ? "builds" : "build"} on it`);
  if (asked.length) parts.push(`also asked for by ${join(asked)}`);
  if (parts.length) text += `; ${parts.join("; ")}`;
  return { tldr: `${text}.` };
}

// A portfolio brief summary, written from the facts block the api sends.
// Deterministic, so the demo (and tests) always read the same way.
function briefSummary(prompt) {
  // A section heading is on a line of its own (the totals line mentions some too).
  const section = (title) => {
    const start = prompt.indexOf(`\n${title}\n`);
    if (start === -1) return [];
    const rest = prompt.slice(start + title.length + 1).split("\n\n")[0];
    return rest.split("\n").filter((l) => l.startsWith("- ") && l !== "- none");
  };
  // "Title" [id] (Team, contact Name)
  const refs = (line) =>
    [...line.matchAll(/"([^"]+)" \[([0-9a-f-]{36})\] \(([^,)]+)(?:, contact ([^)]+))?\)/g)].map(
      (m) => ({ title: m[1], id: m[2], team: m[3], contact: m[4] }),
    );
  // "A, B, C" -> "A, B and C"
  const and = (s) => (s ?? "").replace(/, ([^,]+)$/, " and $1");
  const talk = (...rs) => {
    const names = [...new Set(rs.map((r) => r.contact).filter(Boolean))];
    return names.length ? `; ${and(names.join(", "))} should talk` : "";
  };
  const points = [];
  let headline = "";

  const dup = section("Possible duplicates:")[0];
  if (dup) {
    const [a, b] = refs(dup);
    const pct = dup.match(/(\d+)% similar/)?.[1];
    headline = `${a.team} and ${b.team} may be building the same thing.`;
    points.push({
      text: `${a.team}'s "${a.title}" and ${b.team}'s "${b.title}" look like the same work (${pct}% similar)${talk(a, b)} before both are funded.`,
      initiativeIds: [a.id, b.id],
    });
  }
  const wanted = section("Wanted by other teams (asked, or building on it):").find((l) =>
    /wanted by [2-9]/.test(l),
  );
  if (wanted) {
    const [w] = refs(wanted);
    const n = wanted.match(/wanted by (\d+) team/)?.[1];
    const uncommitted = /Nobody has committed/.test(wanted);
    headline ||= `"${w.title}" is wanted by ${n} teams${uncommitted ? " and nobody has picked it up" : ""}.`;
    points.push({
      text: uncommitted
        ? `"${w.title}" (${w.team}) is wanted by ${n} teams but nobody has committed to it; decide whether to staff it as shared work.`
        : `"${w.title}" (${w.team}) is wanted by ${n} teams; make sure its scope covers them.`,
      initiativeIds: [w.id],
    });
  }
  const risk = section("Built on by other teams, but on hold or gone quiet:")[0];
  if (risk) {
    const [r] = refs(risk);
    const by = and(risk.match(/built on by (.+)\.$/)?.[1]);
    points.push({
      text: `"${r.title}" (${r.team}) has stalled while ${by} build on it${talk(r)} about its plans.`,
      initiativeIds: [r.id],
    });
  }
  const theme = section("Emerging themes (new work, by number of teams):").find((l) =>
    / across [^;]+, /.test(l),
  );
  if (theme && points.length < 4) {
    const tag = theme.match(/^- ([^:]+):/)?.[1]?.replace(/ \/ /g, " and ");
    const examples = refs(theme);
    const teams = and(theme.match(/ across ([^;]+);/)?.[1]);
    points.push({
      text: `${teams} have ${/,/.test(teams) ? "all" : "both"} started on ${tag} separately; one shared plan would avoid parallel builds.`,
      initiativeIds: examples.map((e) => e.id),
    });
  }
  const totals = prompt.match(/Totals: (\d+) live initiatives across (\d+) teams/);
  headline ||= `Nothing needs a decision across ${totals?.[2] ?? "the"} teams' ${totals?.[1] ?? ""} initiatives.`;
  return { headline, points: points.slice(0, 4) };
}

// ---------------------------------------------------------------------------

function respond(body) {
  const prompt = (body.messages ?? [])
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
  // Admin → AI & models → Test connection.
  if (prompt.includes("Scry connection test")) return { ok: true };
  // The brief summary's schema has headline; the draft's has tier.
  const schema = JSON.stringify(body);
  if (/"headline"/.test(schema)) return briefSummary(prompt);
  if (/"coverage"/.test(schema)) return assist(prompt);
  if (/"tldr"/.test(schema)) return tldr(prompt);
  return draft(prompt);
}

// ---------- optional auth ----------

const API_KEY = process.env.DEMO_LLM_API_KEY?.trim();
const JWKS_URLS = (process.env.DEMO_LLM_JWKS_URL ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const AUDIENCE = process.env.DEMO_LLM_JWT_AUDIENCE?.trim();
const jwksCache = new Map(); // url -> { keys, at }

async function jwks(url, fresh = false) {
  const hit = jwksCache.get(url);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.keys;
  const res = await fetch(url);
  const { keys = [] } = await res.json();
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}

async function verifyJwt(token) {
  const [h, p, sig] = token.split(".");
  if (!sig) throw new Error("not a JWT");
  const header = JSON.parse(Buffer.from(h, "base64url"));
  const payload = JSON.parse(Buffer.from(p, "base64url"));
  if (header.alg !== "RS256") throw new Error(`unsupported alg ${header.alg}`);
  for (const url of JWKS_URLS) {
    // Unknown kid: the issuer may have rotated since we cached — refetch once.
    const find = async (fresh) =>
      (await jwks(url, fresh).catch(() => [])).find((k) => k.kid === header.kid);
    const jwk = (await find(false)) ?? (await find(true));
    if (!jwk) continue;
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${h}.${p}`),
      key,
      Buffer.from(sig, "base64url"),
    );
    if (!ok) throw new Error("bad signature");
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now())
      throw new Error("token expired");
    const aud = [payload.aud].flat();
    if (AUDIENCE && !aud.includes(AUDIENCE)) throw new Error(`audience must include ${AUDIENCE}`);
    return payload;
  }
  throw new Error(`no key with kid ${header.kid} in ${JWKS_URLS.join(", ")}`);
}

/** Returns an error message, or null when the request may proceed. */
async function checkAuth(req) {
  if (!API_KEY && JWKS_URLS.length === 0) return null;
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return "Missing bearer token";
  if (API_KEY && token === API_KEY) return null;
  const looksLikeJwt = token.split(".").length === 3;
  if (JWKS_URLS.length && (looksLikeJwt || !API_KEY)) {
    try {
      const claims = await verifyJwt(token);
      console.log(`authorised JWT: iss=${claims.iss} sub=${claims.sub} aud=${claims.aud}`);
      return null;
    } catch (err) {
      return `Invalid JWT: ${err.message}`;
    }
  }
  return "Invalid API key";
}

/**
 * Server-sent chunks in OpenAI's streaming format, a few characters at a
 * time with a short pause, so streamed answers visibly stream in the demo.
 */
async function streamCompletion(res, body, text, tool) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const base = {
    id: `chatcmpl-demo-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
  };
  const chunk = (delta, finish = null) =>
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    );
  chunk(
    tool
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              index: 0,
              id: callId(),
              type: "function",
              function: { name: tool, arguments: "" },
            },
          ],
        }
      : { role: "assistant", content: "" },
  );
  for (let i = 0; i < text.length; i += 6) {
    const piece = text.slice(i, i + 6);
    chunk(
      tool ? { tool_calls: [{ index: 0, function: { arguments: piece } }] } : { content: piece },
    );
    await new Promise((r) => setTimeout(r, 12));
  }
  chunk({}, tool ? "tool_calls" : "stop");
  res.write(
    `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
}

/** A non-streamed chat completion: `text` is the answer, or a tool call's arguments. */
function completion(body, tool, text) {
  const message = tool
    ? {
        role: "assistant",
        content: null,
        tool_calls: [{ id: callId(), type: "function", function: { name: tool, arguments: text } }],
      }
    : { role: "assistant", content: text };
  return {
    id: `chatcmpl-demo-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message, finish_reason: tool ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// Tool results are matched to their call by id, across the steps of a turn.
const callId = () => `call_demo_${Math.random().toString(36).slice(2, 10)}`;

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return send(res, 200, { status: "ok" });
      }
      const denied = await checkAuth(req);
      if (denied) {
        return send(res, 401, { error: { message: denied, type: "authentication_error" } });
      }
      if (req.method === "GET" && req.url?.endsWith("/models")) {
        return send(res, 200, { object: "list", data: [{ id: "scry-demo", object: "model" }] });
      }
      const body = raw ? JSON.parse(raw) : {};

      if (req.url?.endsWith("/embeddings")) {
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        return send(res, 200, {
          object: "list",
          model: body.model,
          data: inputs.map((text, index) => {
            const size = Number(String(body.model ?? "").match(/-(\d{2,5})$/)?.[1]) || DIMENSIONS;
            let vector = embed(String(text ?? ""), size);
            // Like OpenAI's text-embedding-3-*: shorten and re-normalise.
            if (Number(body.dimensions) > 0 && body.dimensions < vector.length) {
              vector = vector.slice(0, body.dimensions);
              const norm = Math.hypot(...vector) || 1;
              vector = vector.map((x) => x / norm);
            }
            // The OpenAI SDK asks for base64 float32 by default.
            const embedding =
              body.encoding_format === "base64"
                ? Buffer.from(new Float32Array(vector).buffer).toString("base64")
                : vector;
            return { object: "embedding", index, embedding };
          }),
          usage: { prompt_tokens: 0, total_tokens: 0 },
        });
      }

      if (req.url?.endsWith("/chat/completions")) {
        if (body.tools?.some((t) => t.function?.name === "search_initiatives")) {
          const step = agentStep(body);
          if (body.stream) {
            return step.tool
              ? streamCompletion(res, body, JSON.stringify(step.args), step.tool)
              : streamCompletion(res, body, step.text);
          }
          return send(
            res,
            200,
            completion(body, step.tool, step.tool ? JSON.stringify(step.args) : step.text),
          );
        }
        const result = respond(body);
        const tool = body.tools?.[0]?.function?.name;
        if (body.stream) return streamCompletion(res, body, JSON.stringify(result), tool);
        return send(res, 200, completion(body, tool, JSON.stringify(result)));
      }

      send(res, 404, { error: { message: `Not supported by the demo LLM: ${req.url}` } });
    } catch (err) {
      send(res, 400, { error: { message: String(err?.message ?? err) } });
    }
  });
});

// Only listen when run directly, so the module can be imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => console.log(`Scry demo LLM listening on :${PORT}`));
}
