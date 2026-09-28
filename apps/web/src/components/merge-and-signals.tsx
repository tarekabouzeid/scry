"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, GitMerge, HandHeart } from "lucide-react";
import type { Initiative } from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import {
  queryKeys,
  useInitiativesById,
  useInvalidateInitiatives,
  useOverlapsFor,
  useTeamLookup,
} from "@/lib/queries";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Field } from "./ui/form";
import { ErrorNote, Skeleton } from "./ui/feedback";
import { useToast } from "./ui/toast";
import { useWorkspace } from "./workspace";
import { canEditInitiative } from "@/lib/permissions";

/** Shown on an initiative that was folded into another as a duplicate. */
export function MergedBanner({ initiative }: { initiative: Initiative }) {
  const initiativeOf = useInitiativesById([initiative.mergedIntoId]);
  const teamOf = useTeamLookup();
  const { select } = useWorkspace();
  if (!initiative.mergedIntoId) return null;
  const target = initiativeOf(initiative.mergedIntoId);
  return (
    <div className="border-b border-border bg-status-shipped/6 p-5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-status-shipped">
        <GitMerge className="h-3.5 w-3.5" />
        Merged{initiative.mergedAt ? ` on ${formatDate(initiative.mergedAt)}` : ""}
      </p>
      <p className="mt-1 text-sm text-muted">
        This was a duplicate. Work continues in{" "}
        <button
          type="button"
          onClick={() => select(initiative.mergedIntoId!)}
          className="inline-flex items-center gap-0.5 font-medium text-foreground hover:text-accent"
        >
          {target?.title ?? "the initiative it was merged into"}
          <ArrowUpRight className="h-3 w-3" />
        </button>
        {target ? ` (${teamOf(target.teamId)?.name ?? "another team"})` : ""}. Its discussion and
        history stay here.
      </p>
    </div>
  );
}

/**
 * Open requests to merge a duplicate: on the target, the people who decide
 * see Merge / Decline; on the duplicate, whoever asked can withdraw.
 */
export function MergeRequestsBanner({ initiative }: { initiative: Initiative }) {
  const { select } = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateInitiatives();
  const { data: requests } = useQuery({
    queryKey: queryKeys.mergeRequests(initiative.id),
    queryFn: () => api.listMergeRequests(initiative.id),
    enabled: !initiative.mergedIntoId,
  });
  const act = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "approve" | "decline" | "withdraw";
    }) => {
      if (action === "approve") await api.approveMergeRequest(id);
      else if (action === "decline") await api.declineMergeRequest(id);
      else await api.withdrawMergeRequest(id);
    },
    onSuccess: async (_, { action }) => {
      await invalidate();
      toast({
        tone: "success",
        message:
          action === "approve"
            ? "Merged"
            : action === "decline"
              ? "Declined; they've been told"
              : "Request withdrawn",
      });
    },
  });
  if (!requests?.length) return null;
  return (
    <>
      {requests.map((r) => {
        const incoming = r.target.id === initiative.id;
        const other = incoming ? r.source : r.target;
        return (
          <section
            key={r.id}
            aria-label="Merge request"
            className="border-b border-border bg-accent/6 p-5"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
              <GitMerge className="h-3.5 w-3.5" />
              {incoming ? "Asked to merge into this" : "Waiting to be merged"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {incoming ? (
                <>
                  {r.requestedBy?.name ?? "Someone"} ({other.teamName}) thinks{" "}
                  <OtherLink id={other.id} title={other.title} onOpen={select} /> duplicates this
                  and asks to fold it in. Its relationships, followers, tags and demand would move
                  here.
                </>
              ) : (
                <>
                  Asked {other.teamName} to accept merging this into{" "}
                  <OtherLink id={other.id} title={other.title} onOpen={select} />. Nothing changes
                  until they do.
                </>
              )}
            </p>
            {(incoming ? r.canDecide : r.canWithdraw) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {incoming ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: r.id, action: "approve" })}
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                      Merge
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: r.id, action: "decline" })}
                    >
                      Decline
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: r.id, action: "withdraw" })}
                  >
                    Withdraw
                  </Button>
                )}
              </div>
            )}
            {incoming && !r.canDecide && (
              <p className="mt-2 text-xs text-subtle">
                This initiative&apos;s owners and its team admins decide.
              </p>
            )}
            {act.error && <ErrorNote className="mt-2">{act.error.message}</ErrorNote>}
          </section>
        );
      })}
    </>
  );
}

function OtherLink({
  id,
  title,
  onOpen,
}: {
  id: string;
  title: string;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className="inline-flex items-center gap-0.5 font-medium text-foreground hover:text-accent"
    >
      “{title}”
      <ArrowUpRight className="h-3 w-3" />
    </button>
  );
}

/**
 * "Also needed by": other teams saying this matters to them. Anyone outside
 * the owning team can add their team's voice, with an optional why.
 */
export function SignalsSection({ initiative }: { initiative: Initiative }) {
  const { user } = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateInitiatives();
  const [note, setNote] = useState("");
  const [composing, setComposing] = useState(false);
  const { data: signals, isLoading } = useQuery({
    queryKey: queryKeys.signals(initiative.id),
    queryFn: () => api.listSignals(initiative.id),
  });
  const mine = signals?.find((s) => s.user.id === user.id);
  const canSignal = !!user.teamId && user.teamId !== initiative.teamId && !initiative.mergedIntoId;

  const byTeam = useMemo(() => {
    const groups = new Map<string, { name: string; people: NonNullable<typeof signals> }>();
    for (const s of signals ?? []) {
      const g = groups.get(s.team.id) ?? { name: s.team.name, people: [] };
      g.people.push(s);
      groups.set(s.team.id, g);
    }
    return [...groups.values()];
  }, [signals]);

  const add = useMutation({
    mutationFn: (text: string) => api.addSignal(initiative.id, text),
    onSuccess: async () => {
      setComposing(false);
      setNote("");
      await invalidate();
      toast({
        tone: "success",
        message: mine
          ? "Confirmed — your team still needs it"
          : "Your team's interest is recorded — the owners were told",
      });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  const remove = useMutation({
    mutationFn: () => api.removeSignal(initiative.id),
    onSuccess: () => invalidate(),
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  if (!canSignal && !isLoading && !signals?.length) return null;

  return (
    <div className="border-b border-border p-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
          <HandHeart className="h-3 w-3" />
          Also needed by {byTeam.length ? `· ${byTeam.length}` : ""}
        </p>
        {canSignal &&
          (mine ? (
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-elevated hover:text-foreground"
            >
              Withdraw
            </button>
          ) : (
            !composing && (
              <Button size="sm" onClick={() => setComposing(true)}>
                <HandHeart className="h-3.5 w-3.5" />
                We need this too
              </Button>
            )
          ))}
      </div>
      {composing && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim().length >= 3) add.mutate(note.trim());
          }}
        >
          <Input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why your team needs it"
            aria-label="Why your team needs it"
            maxLength={280}
            className="flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={add.isPending || note.trim().length < 3}
          >
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setComposing(false)}>
            Cancel
          </Button>
        </form>
      )}
      {isLoading ? (
        <Skeleton className="h-10" />
      ) : byTeam.length === 0 ? (
        <p className="text-xs text-subtle">
          No other team has said they need this yet. Demand from several teams is a good reason to
          build something once, together.
        </p>
      ) : (
        <ul className="space-y-2">
          {byTeam.map((g) => (
            <li key={g.name} className="rounded-lg border border-border bg-background/50 px-3 py-2">
              <p className="text-sm font-medium text-foreground">{g.name}</p>
              <ul className="mt-0.5 space-y-0.5">
                {g.people.map((p) => (
                  <li
                    key={p.id}
                    className={cn("text-xs text-muted", p.stale && "opacity-60")}
                    title={`Last confirmed ${formatDate(p.confirmedAt)}`}
                  >
                    {p.user.name}
                    {p.note && <span className="text-subtle"> — “{p.note}”</span>}
                    {p.stale && (
                      <span className="text-subtle">
                        {" "}
                        · asked {formatDate(p.confirmedAt)}, not confirmed since
                        {p.user.id === user.id && p.note && (
                          <button
                            type="button"
                            onClick={() => add.mutate(p.note!)}
                            disabled={add.isPending}
                            className="ml-1.5 font-medium text-foreground hover:underline"
                          >
                            Still needed
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Fold `source` into the initiative it duplicates. Only a flagged duplicate
 * (an open overlap) can be the target, the api refuses anything else: from
 * an overlap card the target is that pair; from the menu, one of this
 * initiative's flagged duplicates. Explains exactly what moves, and shows a
 * request already waiting (with Withdraw) instead of failing on it.
 */
export function MergeDialog({
  source,
  initialTargetId,
  open,
  onClose,
}: {
  source: Initiative;
  /** The overlap card's pair: fixed, no choosing another. */
  initialTargetId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { select, user } = useWorkspace();
  const toast = useToast();
  const invalidate = useInvalidateInitiatives();
  const teamOf = useTeamLookup();
  const sourceIds = useMemo(() => [source.id], [source.id]);
  const flaggedIds = (useOverlapsFor(sourceIds).get(source.id) ?? []).map((o) =>
    o.initiativeAId === source.id ? o.initiativeBId : o.initiativeAId,
  );
  const initiativeOf = useInitiativesById(flaggedIds);
  const [targetId, setTargetId] = useState(initialTargetId ?? "");
  // One flagged duplicate: that's the target. Several: choose among them.
  const chosen = initialTargetId ?? (flaggedIds.length === 1 ? flaggedIds[0]! : targetId);
  const target = useInitiativesById([chosen])(chosen);
  const crossTeam = target && target.teamId !== source.teamId;
  // The target takes on the duplicate's relationships and demand, so its
  // owners decide unless you can edit it too (the api applies the same rule).
  const asks = !!target && !canEditInitiative(user, target);
  const targetTeam = target ? (teamOf(target.teamId)?.name ?? "the other team") : "";

  const { data: requests } = useQuery({
    queryKey: queryKeys.mergeRequests(source.id),
    queryFn: () => api.listMergeRequests(source.id),
    enabled: open,
  });
  const waiting = requests?.find((r) => r.source.id === source.id);

  const merge = useMutation({
    mutationFn: () => api.mergeInitiative(source.id, chosen),
    onSuccess: async (result) => {
      await invalidate();
      onClose();
      if (result.outcome === "merged") {
        select(result.initiative.id);
        toast({ tone: "success", message: `Merged into “${result.initiative.title}”` });
      } else {
        toast({
          tone: "success",
          message: `Asked ${result.request.target.teamName} to accept the merge`,
        });
      }
    },
    // A request made elsewhere meanwhile shows up above, with Withdraw.
    onError: () => void invalidate(),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => api.withdrawMergeRequest(id),
    onSuccess: async () => {
      await invalidate();
      merge.reset();
    },
  });

  useEffect(() => {
    if (open) {
      setTargetId(initialTargetId ?? "");
      merge.reset();
      withdraw.reset();
    }
    // reset is stable; only reopening should reset the form.
  }, [open, initialTargetId]);

  const pickable = !initialTargetId && flaggedIds.length > 1;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Merge into the duplicate"
      description={`“${source.title}” was flagged as a duplicate. Fold it into the one that carries on.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => merge.mutate()}
            disabled={!target || !!waiting || merge.isPending}
          >
            <GitMerge className="h-3.5 w-3.5" />
            {asks ? "Ask to merge" : "Merge"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {waiting && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-foreground">
            <p>
              You already asked {waiting.target.teamName} to accept merging this into “
              {waiting.target.title}”. Withdraw that request to merge differently.
            </p>
            {waiting.canWithdraw && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                disabled={withdraw.isPending}
                onClick={() => withdraw.mutate(waiting.id)}
              >
                Withdraw the request
              </Button>
            )}
            {withdraw.error && <ErrorNote className="mt-2">{withdraw.error.message}</ErrorNote>}
          </div>
        )}
        <Field label="Keep working in">
          {flaggedIds.length === 0 && !initialTargetId ? (
            <p className="rounded-lg border border-border bg-elevated/40 px-3 py-2 text-sm text-muted">
              Nothing is flagged as a duplicate of this. Only a flagged duplicate can be merged.
            </p>
          ) : pickable ? (
            <div role="radiogroup" aria-label="Flagged duplicates" className="space-y-1.5">
              {flaggedIds.map((id) => {
                const other = initiativeOf(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={chosen === id}
                    onClick={() => setTargetId(id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      chosen === id
                        ? "border-accent/50 bg-accent/5 text-foreground"
                        : "border-border text-muted hover:bg-elevated",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{other?.title ?? "…"}</span>
                    <span className="shrink-0 truncate text-[11px] text-subtle">
                      {other ? teamOf(other.teamId)?.name : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-elevated/40 px-3 py-2 text-sm text-foreground">
              {target?.title ?? "…"}
              {target && (
                <span className="text-subtle">
                  {" "}
                  — {teamOf(target.teamId)?.name ?? "another team"}
                </span>
              )}
            </div>
          )}
        </Field>
        {asks && !waiting && (
          <p className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-foreground">
            “{target.title}” isn&apos;t yours, so its owners and {targetTeam}&apos;s team admins
            decide. They&apos;re notified now, and nothing changes until one of them accepts.
          </p>
        )}
        {target && (
          <ul className="space-y-1.5 rounded-lg border border-border bg-elevated/40 p-3 text-xs text-muted">
            <li>
              • “{source.title}” is marked <strong>merged</strong> and cancelled. Its comments and
              history stay readable, with a link to where work continues.
            </li>
            <li>• Its relationships, followers, tags and “needed by” signals move over.</li>
            {crossTeam && (
              <li>
                • {teamOf(source.teamId)?.name ?? "Your team"} is recorded as also needing “
                {target.title}”, so the demand isn&apos;t lost.
              </li>
            )}
            <li>
              • Both teams&apos; owners and team admins are notified. This can&apos;t be undone from
              the UI.
            </li>
          </ul>
        )}
        {merge.error && !waiting && <ErrorNote>{merge.error.message}</ErrorNote>}
      </div>
    </Dialog>
  );
}
