"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Layers } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useLlmStatus, useTeamLookup, useUserLookup } from "@/lib/queries";
import { STATUS_META } from "@/lib/format";
import { linkTo } from "@/lib/url-state";
import { Avatar } from "./ui/avatar";
import { Spinner } from "./ui/feedback";

/** Wait for a pause in typing before asking: every check embeds the text. */
function useSettled(value: string, ms = 800) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * "Does this already exist?", answered while someone drafts an initiative —
 * so registering directly gets the same check as asking Scry first.
 */
export function SimilarWork({ title, summary }: { title: string; summary: string }) {
  const { data: llm } = useLlmStatus();
  const teamOf = useTeamLookup();
  const userOf = useUserLookup();
  const text = useSettled(`${title.trim()}\n${summary.trim()}`.trim());
  const enough = text.length >= 12;
  const { data, isFetching, isError } = useQuery({
    queryKey: ["similar", text],
    queryFn: () => api.similar(text),
    enabled: llm?.configured === true && enough,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  if (llm?.configured !== true || !enough || isError) return null;
  if (!data)
    return (
      <p className="flex items-center gap-2 text-xs text-subtle sm:col-span-2" role="status">
        <Spinner className="h-3.5 w-3.5 text-subtle" />
        Checking for similar work…
      </p>
    );

  if (data.length === 0)
    return (
      <p className="flex items-center gap-2 text-xs text-muted sm:col-span-2" role="status">
        {isFetching ? (
          <Spinner className="h-3.5 w-3.5 text-subtle" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-status-shipped" />
        )}
        No similar work registered yet.
      </p>
    );

  const strong = data.some((m) => m.strength === "strong");
  return (
    <section
      aria-label="Similar work"
      role="status"
      className={cn(
        "rounded-lg border px-3 py-2.5 sm:col-span-2",
        strong ? "border-warning/40 bg-warning/5" : "border-border bg-elevated/40",
      )}
    >
      <p className="flex items-center gap-2 text-xs font-medium text-foreground">
        {strong ? (
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        ) : (
          <Layers className="h-3.5 w-3.5 text-subtle" />
        )}
        {strong ? "This may already exist" : "Related work already registered"}
        {isFetching && <Spinner className="h-3 w-3 text-subtle" />}
      </p>
      <ul className="mt-2 space-y-2">
        {data.map(({ initiative: i, score, strength }) => {
          const team = teamOf(i.teamId);
          const contact = userOf(i.contactPerson);
          return (
            <li key={i.id} className="flex items-start gap-2.5">
              <Avatar id={i.teamId} name={team?.name ?? "?"} size="xs" square />
              <div className="min-w-0 flex-1 text-sm leading-snug">
                <a
                  href={linkTo({ i: i.id })}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex items-center gap-1 rounded-sm font-medium text-foreground hover:underline"
                >
                  {i.title}
                  <ExternalLink className="h-3 w-3 text-subtle" />
                </a>
                <p className="text-xs text-muted">
                  {team?.name ?? "Another team"} ·{" "}
                  <span className="inline-flex items-center gap-1">
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[i.status].dot)} />
                    {STATUS_META[i.status].label}
                  </span>
                  {contact && <> · talk to {contact.name}</>}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-xs tabular-nums",
                  strength === "strong" ? "text-warning" : "text-subtle",
                )}
                title="How close the meaning is"
              >
                {Math.round(score * 100)}%
              </span>
            </li>
          );
        })}
      </ul>
      {strong && (
        <p className="mt-2 text-xs text-muted">
          If it&apos;s the same thing, joining them beats building it twice. You can still create
          yours if it&apos;s different.
        </p>
      )}
    </section>
  );
}
