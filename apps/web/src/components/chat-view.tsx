"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUp,
  Ban,
  CheckCircle2,
  FilePlus2,
  GitBranch,
  Lightbulb,
  Link2,
  Search,
  Sparkles,
  Undo2,
} from "lucide-react";
import {
  ideaFromConversation,
  type ChatActivity,
  type ChatMessage,
  type ChatMessageEvidence,
  type ChatSession,
  type EdgeType,
  type Initiative,
  type MatchClassification,
} from "@scry/shared";
import { api, type InitiativeInput } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  queryKeys,
  useInitiativesById,
  useInvalidateInitiatives,
  useLlmStatus,
  useTeamLookup,
} from "@/lib/queries";
import { EDGE_LABEL } from "@/lib/format";
import { Avatar } from "./ui/avatar";
import { StatusBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { ErrorNote, Kbd, Skeleton } from "./ui/feedback";
import { LogoMark } from "./ui/logo";
import { MenuItem, Popover } from "./ui/popover";
import { useToast } from "./ui/toast";
import { InitiativeFormDialog } from "./initiative-form";
import { AiSetupNotice } from "./ai-setup-notice";
import { useWorkspace } from "./workspace";
import { takeQuestion } from "@/lib/ask";

const SUGGESTIONS = [
  "Dashboards so account managers can explore customer analytics themselves",
  "Fraud risk scoring when onboarding new merchants",
  "Passwordless login for customers using passkeys",
  "Carbon footprint reporting for business customers",
];

/** Render **bold** spans from model output as <strong> — text only, no HTML. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

function matchStrength(score: number, matching = { strongMatch: 0.85, weakMatch: 0.65 }) {
  if (score >= matching.strongMatch)
    return { label: "Strong match", bar: "bg-status-blocked", text: "text-status-blocked" };
  if (score >= matching.weakMatch)
    return { label: "Possible match", bar: "bg-warning", text: "text-warning" };
  return { label: "Weak match", bar: "bg-status-idea", text: "text-muted" };
}

const EDGE_TYPES = Object.keys(EDGE_LABEL) as EdgeType[];

interface EvidenceContext {
  sessionId: string;
  messageId: string;
  registeredInitiativeId: string | null;
}

function EvidenceActions({
  evidence,
  ctx,
}: {
  evidence: ChatMessageEvidence;
  ctx: EvidenceContext;
}) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInitiatives();
  const toast = useToast();
  const decide = useMutation({
    mutationFn: (dto: { decision: "linked" | "dismissed" | null; edgeType?: EdgeType }) =>
      api.decideEvidence(ctx.sessionId, ctx.messageId, {
        initiativeId: evidence.initiativeId,
        ...dto,
      }),
    onSuccess: async (_d, dto) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatSession(ctx.sessionId) });
      if (dto.decision === "linked") {
        await invalidate();
        toast({ tone: "success", message: "Linked — it's now a confirmed relationship" });
      }
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  if (evidence.decision) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        {evidence.decision === "linked" ? (
          <span className="inline-flex items-center gap-1 text-status-shipped">
            <CheckCircle2 className="h-3 w-3" /> Linked to your initiative
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-subtle">
            <Ban className="h-3 w-3" /> Marked not related
          </span>
        )}
        {evidence.decision === "dismissed" && (
          <button
            type="button"
            onClick={() => decide.mutate({ decision: null })}
            className="inline-flex items-center gap-1 text-muted hover:text-foreground"
          >
            <Undo2 className="h-3 w-3" /> Undo
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ctx.registeredInitiativeId ? (
        <Popover
          align="start"
          className="w-52 p-1"
          trigger={({ toggle }) => (
            <Button size="sm" onClick={toggle} disabled={decide.isPending}>
              <Link2 className="h-3.5 w-3.5" />
              Link as…
            </Button>
          )}
        >
          {(close) =>
            EDGE_TYPES.map((t) => (
              <MenuItem
                key={t}
                onClick={() => {
                  close();
                  decide.mutate({ decision: "linked", edgeType: t });
                }}
              >
                {t === "related"
                  ? "Mine is related to this"
                  : `Mine ${EDGE_LABEL[t].outgoing.toLowerCase()} this`}
              </MenuItem>
            ))
          }
        </Popover>
      ) : (
        <span className="text-[11px] text-subtle">Register your idea to link it here.</span>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ decision: "dismissed" })}
      >
        Not related
      </Button>
    </div>
  );
}

function EvidenceCard({
  evidence,
  onOpen,
  ctx,
}: {
  evidence: ChatMessageEvidence;
  onOpen: (id: string) => void;
  ctx?: EvidenceContext;
}) {
  // Cards mount together, so their lookups go out as one request.
  const initiativeOf = useInitiativesById([evidence.initiativeId, evidence.throughInitiativeId]);
  const teamOf = useTeamLookup();
  const initiative = initiativeOf(evidence.initiativeId);
  const through = evidence.throughInitiativeId
    ? initiativeOf(evidence.throughInitiativeId)
    : undefined;
  const team = initiative ? teamOf(initiative.teamId) : undefined;
  const matching = useLlmStatus().data?.matching;
  const score = evidence.score ?? 0;
  const strength = matchStrength(score, matching);

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border bg-background/60 p-3 transition-colors",
        evidence.decision === "dismissed"
          ? "border-border/60 opacity-60"
          : evidence.decision === "linked"
            ? "border-status-shipped/30"
            : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(evidence.initiativeId)}
          className="focus-ring group min-w-0 rounded-sm text-left"
        >
          <p className="truncate text-sm font-medium text-foreground group-hover:text-accent">
            {initiative?.title ?? "Initiative"}
          </p>
          {team && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
              <Avatar id={team.id} name={team.name} size="xs" square />
              {team.name}
            </p>
          )}
        </button>
        {initiative && <StatusBadge status={initiative.status} />}
      </div>
      {evidence.via === "semantic" ? (
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
            <div
              className={cn("h-full rounded-full", strength.bar)}
              style={{ width: `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%` }}
            />
          </div>
          <span className={cn("whitespace-nowrap text-[11px] font-medium", strength.text)}>
            {strength.label} · {Math.round(score * 100)}%
          </span>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <GitBranch className="h-3 w-3 text-accent" />
          {evidence.hops ?? 1} hop{(evidence.hops ?? 1) === 1 ? "" : "s"} away
          {through && (
            <>
              {" "}
              via <span className="truncate text-foreground">{through.title}</span>
            </>
          )}
        </p>
      )}
      {ctx && <EvidenceActions evidence={evidence} ctx={ctx} />}
    </div>
  );
}

function MessageRow({
  message,
  userName,
  userId,
  onOpenInitiative,
  ctx,
}: {
  message: Pick<ChatMessage, "role" | "content" | "evidence"> & { searchQuery?: string | null };
  userName: string;
  userId: string;
  onOpenInitiative: (id: string) => void;
  ctx?: EvidenceContext;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3 animate-fade-in", isUser && "flex-row-reverse")}>
      {isUser ? <Avatar id={userId} name={userName} /> : <LogoMark className="h-8 w-8 shrink-0" />}
      {/* Scry's side is one fixed-width column — answer, evidence and the
          register prompt below all share its edges. */}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2",
          isUser ? "max-w-[85%] items-end" : "w-full max-w-160",
        )}
      >
        <div
          className={cn(
            "whitespace-pre-wrap wrap-break-word rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "rounded-tr-md bg-accent-gradient text-white shadow-glow"
              : "rounded-tl-md border border-border bg-surface text-foreground shadow-card",
          )}
        >
          {isUser ? message.content : <RichText text={message.content} />}
        </div>
        {!isUser && message.searchQuery && (
          <p className="flex items-center gap-1.5 px-1 text-[11px] text-subtle">
            <Search className="h-3 w-3 shrink-0" />
            <span className="min-w-0">Searched for “{message.searchQuery}”</span>
          </p>
        )}
        {message.evidence && message.evidence.length > 0 && (
          <div className="w-full space-y-1.5">
            <p className="flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-subtle">
              <Sparkles className="h-3 w-3 text-accent" />
              Evidence · {message.evidence.length}
            </p>
            {message.evidence.map((e) => (
              <EvidenceCard key={e.initiativeId} evidence={e} onOpen={onOpenInitiative} ctx={ctx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const CTA_COPY: Record<MatchClassification, { title: string; body: string; primary: boolean }> = {
  NO_MATCH: {
    title: "Nothing similar found",
    body: "Register it so other teams can see it — and so Scry can catch the next overlap.",
    primary: true,
  },
  WEAK_MATCH: {
    title: "Genuinely different?",
    body: "If it's not the same thing, register it and link it to the related work above.",
    primary: true,
  },
  STRONG_MATCH: {
    title: "Looks like this already exists",
    body: "Talk to the owning team first. If it's really distinct, you can still register it.",
    primary: false,
  },
};

function RegisterCta({
  classification,
  onRegister,
}: {
  classification: MatchClassification;
  onRegister: () => void;
}) {
  const copy = CTA_COPY[classification];
  const { title, body } = copy;
  return (
    <div className="ml-11 flex max-w-160 flex-col gap-3 rounded-xl border border-dashed border-accent/40 bg-accent/5 p-4 animate-fade-in sm:flex-row sm:items-center">
      <FilePlus2 className="hidden h-5 w-5 shrink-0 text-accent sm:block" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted">{body}</p>
      </div>
      <Button variant={copy.primary ? "primary" : "secondary"} onClick={onRegister}>
        {copy.primary ? "Register this idea" : "Register anyway"}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function RegisteredBanner({ initiative, onOpen }: { initiative?: Initiative; onOpen: () => void }) {
  return (
    <div className="ml-11 flex max-w-160 items-center gap-3 rounded-xl border border-status-shipped/30 bg-status-shipped/5 p-4 animate-fade-in">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-status-shipped" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          Registered{initiative ? <> as “{initiative.title}”</> : ""}
        </p>
        <p className="text-xs text-muted">
          Link it to related work from the evidence above to make the relationship explicit.
        </p>
      </div>
      <Button size="sm" onClick={onOpen}>
        Open
      </Button>
    </div>
  );
}

function lastIndex<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i]!)) return i;
  return -1;
}

function activityText(activity: ChatActivity | null): string {
  if (!activity) return "Thinking…";
  if (activity.tool === "search_initiatives") return `Searching for “${activity.query}”…`;
  if (activity.tool === "get_initiative") return `Looking up ${activity.title}…`;
  return "Getting the Register button ready…";
}

function TypingIndicator({ activity }: { activity: ChatActivity | null }) {
  return (
    <div className="flex gap-3 animate-fade-in">
      <LogoMark className="h-8 w-8 shrink-0" />
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3 shadow-card">
        <span className="flex gap-1">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-accent"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="text-xs text-muted" aria-live="polite">
          {activityText(activity)}
        </span>
      </div>
    </div>
  );
}

export function ChatView({
  sessionId,
  onSessionCreated,
  onSelectInitiative,
  userName,
  userId,
}: {
  sessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  onSelectInitiative: (initiative: { id: string }) => void;
  userName: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const { user, canWrite } = useWorkspace();
  const invalidate = useInvalidateInitiatives();
  const toast = useToast();
  const { data: llmStatus } = useLlmStatus();
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.chatSession(sessionId ?? ""),
    queryFn: () => api.getChatSession(sessionId!),
    enabled: !!sessionId,
  });
  const session: ChatSession | undefined = data?.session;
  const initiativeOf = useInitiativesById([session?.registeredInitiativeId]);

  const [registerOpen, setRegisterOpen] = useState(false);
  const draft = useMutation({
    mutationFn: ({ id, signal }: { id: string; signal: AbortSignal }) =>
      api.draftInitiative(id, signal),
  });
  // A slow or stuck model shouldn't hold the form hostage: Skip (or closing)
  // aborts the request and the form falls back to the user's own words.
  const draftAbort = useRef<AbortController | null>(null);
  const skipDraft = () => draftAbort.current?.abort();
  const draftSkipped = draft.error instanceof DOMException && draft.error.name === "AbortError";
  const openRegister = () => {
    if (!sessionId) return;
    if (!canWrite) {
      toast({ tone: "error", message: "You can register ideas once a team admin lets you in." });
      return;
    }
    setRegisterOpen(true);
    draftAbort.current?.abort();
    draftAbort.current = new AbortController();
    draft.mutate({ id: sessionId, signal: draftAbort.current.signal });
  };
  // The LLM draft, or — if drafting failed — the user's own words.
  const registerInitial = useMemo<Partial<Initiative> | undefined>(() => {
    if (draft.data) return { ...draft.data, status: "idea" };
    if (draft.isError) {
      const { said } = ideaFromConversation(data?.messages ?? []);
      return { title: (said[0] ?? "").slice(0, 80), summary: said.join("\n\n"), status: "idea" };
    }
    return undefined;
  }, [draft.data, draft.isError, data?.messages]);
  const register = async (input: InitiativeInput) => {
    const created = await api.registerFromChat(sessionId!, input);
    await Promise.all([
      invalidate(),
      queryClient.invalidateQueries({ queryKey: queryKeys.chatSession(sessionId!) }),
    ]);
    toast({
      tone: "success",
      message: (
        <>
          Registered <strong>{created.title}</strong>
        </>
      ),
      action: { label: "Open", onClick: () => onSelectInitiative({ id: created.id }) },
    });
  };

  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  // The answer so far, while it streams in.
  const [streamed, setStreamed] = useState("");
  // What the agent is doing (a tool it called), until the answer arrives.
  const [activity, setActivity] = useState<ChatActivity | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Held in a ref so a session created mid-send is reused if the post fails
  // and the user retries, instead of creating a second empty session.
  const sessionIdRef = useRef(sessionId);

  const postMessage = useMutation({
    mutationFn: async (content: string) => {
      let id = sessionIdRef.current;
      if (!id) {
        const session = await api.createChatSession();
        id = session.id;
        sessionIdRef.current = id;
        onSessionCreated(id);
      }
      await api.streamChatMessage(
        id,
        content,
        (delta) => setStreamed((s) => s + delta),
        setActivity,
      );
      return id;
    },
    onMutate: (content) => {
      setPending(content);
      setStreamed("");
      setActivity(null);
      setInput("");
    },
    onSuccess: async (id) => {
      // Await the refetch so the optimistic bubble is swapped for the real
      // message in one paint, without a flash of nothing in between.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.chatSession(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions }),
      ]);
    },
    onError: (_err, content) => {
      // Nothing was persisted — give the user their text back to retry.
      setInput((current) => current || content);
    },
    onSettled: () => {
      setPending(null);
      setStreamed("");
      setActivity(null);
    },
  });

  const messages = data?.messages ?? [];
  // The Register card is the agent's offer (its offer_registration tool),
  // under the reply that made it: once the conversation moves on, it goes.
  // Its wording follows the latest search.
  const lastReply = messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined;
  const lastSearch = [...messages].reverse().find((m) => m.role === "assistant" && m.searchQuery);
  // The "Registered" note belongs where it happened, not after every reply.
  const registered = session?.registeredInitiativeId
    ? initiativeOf(session.registeredInitiativeId)
    : undefined;
  const registeredAfter = registered
    ? lastIndex(messages, (m) => m.createdAt <= registered.createdAt)
    : messages.length - 1;
  const evidenceCtx = (messageId: string): EvidenceContext | undefined =>
    session
      ? {
          sessionId: session.id,
          messageId,
          registeredInitiativeId: session.registeredInitiativeId,
        }
      : undefined;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, streamed.length > 0]);

  // Auto-grow the composer up to a max height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const send = (text = input) => {
    const content = text.trim();
    if (!content || postMessage.isPending) return;
    postMessage.mutate(content);
  };

  // A question handed over from ⌘K or the New initiative dialog. The shell
  // remounts this view for it, so it always starts a fresh conversation.
  useEffect(() => {
    if (sessionIdRef.current) return;
    const question = takeQuestion();
    if (question) send(question);
    // Mount only.
  }, []);

  const showWelcome = !sessionId || (!isLoading && messages.length === 0 && !pending);
  // History stays readable without a model; asking needs one.
  const aiOff = llmStatus?.configured === false;

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
          {showWelcome && !pending && (
            <div className="flex flex-col items-center pt-8 text-center animate-fade-in">
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl bg-accent/40 blur-2xl" />
                <LogoMark className="relative h-14 w-14" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
                Has someone already built this?
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted">
                Describe an idea. Scry checks it against every team&apos;s initiatives — by meaning
                and by explicit relationships — before you register a duplicate.
              </p>
              {aiOff && <AiSetupNotice feature="Ask Scry" className="mt-8 w-full" />}
              <div className={cn("mt-8 grid w-full gap-2 sm:grid-cols-2", aiOff && "hidden")}>
                {SUGGESTIONS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => send(s)}
                    disabled={postMessage.isPending}
                    className="focus-ring group flex items-start gap-2.5 rounded-xl border border-border bg-surface/70 p-3.5 text-left text-sm text-muted transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:text-foreground"
                  >
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-subtle transition-colors group-hover:text-accent" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sessionId && isLoading && (
            <div className="space-y-6">
              <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
              <Skeleton className="h-24 w-3/4 rounded-2xl" />
            </div>
          )}

          {error && <ErrorNote>Couldn&apos;t load this conversation: {error.message}</ErrorNote>}

          {session?.registeredInitiativeId && registeredAfter < 0 && (
            <RegisteredBanner
              initiative={registered}
              onOpen={() => onSelectInitiative({ id: session.registeredInitiativeId! })}
            />
          )}
          {messages.map((message, i) => (
            <Fragment key={message.id}>
              <MessageRow
                message={message}
                userName={userName}
                userId={userId}
                onOpenInitiative={(id) => onSelectInitiative({ id })}
                ctx={evidenceCtx(message.id)}
              />
              {session?.registeredInitiativeId && i === registeredAfter && (
                <RegisteredBanner
                  initiative={registered}
                  onOpen={() => onSelectInitiative({ id: session.registeredInitiativeId! })}
                />
              )}
            </Fragment>
          ))}

          {!pending && session && !session.registeredInitiativeId && lastReply?.registerReady && (
            <RegisterCta
              classification={lastSearch?.classification ?? "NO_MATCH"}
              onRegister={openRegister}
            />
          )}

          {pending && (
            <>
              <MessageRow
                message={{ role: "user", content: pending, evidence: null }}
                userName={userName}
                userId={userId}
                onOpenInitiative={() => undefined}
              />
              {streamed ? (
                <MessageRow
                  message={{ role: "assistant", content: streamed, evidence: null }}
                  userName={userName}
                  userId={userId}
                  onOpenInitiative={() => undefined}
                />
              ) : (
                <TypingIndicator activity={activity} />
              )}
            </>
          )}

          {postMessage.error && (
            <ErrorNote>
              {/* Server messages are whole sentences; don't double the full stop. */}
              {postMessage.error.message.replace(/\.?\s*$/, ".")} Your message is back in the
              composer — try again.
            </ErrorNote>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background/80 px-6 py-4 backdrop-blur-sm">
        {aiOff && !showWelcome && (
          <AiSetupNotice feature="Asking Scry" className="mx-auto max-w-3xl" />
        )}
        <form
          className={cn("mx-auto max-w-3xl", aiOff && "hidden")}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-card transition-colors focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15">
            <textarea
              ref={textareaRef}
              rows={1}
              autoFocus
              placeholder="Describe an idea…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={4000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-hidden"
            />
            <button
              type="submit"
              disabled={!input.trim() || postMessage.isPending}
              aria-label="Send"
              className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-gradient text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-subtle">
            <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
          </p>
        </form>
      </div>

      <InitiativeFormDialog
        open={registerOpen}
        onClose={() => {
          skipDraft();
          setRegisterOpen(false);
        }}
        mode="register"
        initial={registerInitial}
        drafting={draft.isPending}
        onSkipDraft={skipDraft}
        draftNote={
          draftSkipped
            ? "Started from your own words."
            : draft.isError
              ? "Scry couldn't draft this automatically — we've started from your own words."
              : "Drafted by Scry from your conversation."
        }
        defaults={{ teamId: user.teamId ?? "", userId: user.id }}
        canChangeTeam={user.role === "admin"}
        onSubmit={register}
      />
    </div>
  );
}
