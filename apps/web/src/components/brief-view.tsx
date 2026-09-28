"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  Clock,
  Copy,
  FileText,
  HandHeart,
  Layers,
  Printer,
  RefreshCw,
  Sparkles,
  Unplug,
} from "lucide-react";
import {
  DEMAND_STALE_AFTER_DAYS,
  type BriefDecision,
  type BriefInitiativeRef,
  type BriefNarrative,
  type InitiativeStatus,
  type PortfolioBrief,
} from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys, useLlmStatus, useTeams } from "@/lib/queries";
import { STATUS_META, formatDate } from "@/lib/format";
import {
  DECISION_LABEL,
  PERIODS,
  briefAsText,
  changeSentence,
  decisionSentence,
  periodPhrase,
  wantsByTeam,
  type Segment,
} from "@/lib/brief-text";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { EmptyState, ErrorNote, Skeleton, Spinner } from "./ui/feedback";
import { useToast } from "./ui/toast";
import { useWorkspace } from "./workspace";

/** Stages in lifecycle order, for the team mix bars (cancelled isn't counted). */
const STAGES: InitiativeStatus[] = ["idea", "planned", "in_progress", "on_hold", "shipped"];

const KIND_STYLE: Record<BriefDecision["kind"], { icon: typeof Clock; className: string }> = {
  duplicate: { icon: Copy, className: "text-warning bg-warning/10" },
  uncommitted_demand: { icon: HandHeart, className: "text-accent-2 bg-accent-2/10" },
  at_risk: { icon: Unplug, className: "text-warning bg-warning/10" },
  gone_quiet: { icon: Clock, className: "text-muted bg-elevated" },
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
  keepTogether,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  /** On paper, move the whole section to the next page rather than split it. */
  keepTogether?: boolean;
}) {
  return (
    <section
      className={cn(
        "border-t border-border pt-6 print:pt-4",
        keepTogether && "print:break-inside-avoid",
      )}
    >
      <header className="mb-4 break-after-avoid">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** An initiative named inline: a link on screen, plain bold text on paper. */
function Ref({ r }: { r: BriefInitiativeRef }) {
  const { select } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => select(r.id)}
      className="focus-ring rounded-sm text-left font-medium text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-accent print:no-underline"
    >
      {r.title}
    </button>
  );
}

function Sentence({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        typeof s === "string" ? <span key={i}>{s}</span> : <Ref key={i} r={s.ref} />,
      )}
    </>
  );
}

function StatusDot({ r }: { r: BriefInitiativeRef }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-subtle">
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[r.status].dot)} />
      {STATUS_META[r.status].label}
    </span>
  );
}

// ---------------------------------------------------------------------------

/**
 * The opening: sentences computed from the figures, always there. With a
 * model connected, it can be reworded by AI (labelled as such) and put back.
 */
function Summary({
  brief,
  days,
  unit,
  narrative,
  onNarrative,
}: {
  brief: PortfolioBrief;
  days: number;
  unit: string;
  narrative: BriefNarrative | undefined;
  onNarrative: (n: BriefNarrative | undefined) => void;
}) {
  const { data: llm } = useLlmStatus();
  const aiOn = llm?.configured === true;
  const draft = useMutation({
    mutationFn: () => api.briefSummary(days, unit),
    onSuccess: onNarrative,
  });
  const byId = useMemo(() => {
    const m = new Map<string, BriefInitiativeRef>();
    const add = (r?: BriefInitiativeRef) => r && m.set(r.id, r);
    brief.newest.forEach(add);
    brief.emerging.forEach((t) => t.initiatives.forEach(add));
    brief.overlaps.forEach((o) => [o.a, o.b].forEach(add));
    brief.wanted.forEach((w) => [w.initiative, ...w.wants.map((x) => x.via)].forEach(add));
    brief.decisions.forEach((d) => [d.initiative, d.other].forEach(add));
    brief.changes.forEach((c) => [c.initiative, c.other].forEach(add));
    brief.stale.forEach((s) => add(s.initiative));
    return m;
  }, [brief]);

  return (
    <div className="break-inside-avoid rounded-lg border border-border bg-surface px-5 py-4 print:border-neutral-300">
      {narrative ? (
        <>
          <p className="text-lg font-semibold leading-snug tracking-tight text-foreground">
            {narrative.headline}
          </p>
          <ul className="mt-3 space-y-2">
            {narrative.points.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground/90">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-subtle" />
                <span>
                  {p.text}
                  <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle print:hidden">
                    {p.initiativeIds
                      .map((id) => byId.get(id))
                      .filter(Boolean)
                      .map((r) => (
                        <SourceChip key={r!.id} r={r!} />
                      ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="space-y-1.5">
          {brief.summary.map((s, i) => (
            <p
              key={i}
              className={cn(
                "leading-snug",
                i === 0
                  ? "text-lg font-semibold tracking-tight text-foreground"
                  : "text-sm leading-relaxed text-foreground/90",
              )}
            >
              {s}
            </p>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-3 text-xs text-subtle">
        {narrative ? (
          <>
            <Sparkles className="h-3.5 w-3.5" />
            <span className="flex-1">
              Reworded by AI from the figures in this brief. Check it before you share it.
            </span>
            <button
              type="button"
              onClick={() => draft.mutate()}
              disabled={draft.isPending}
              className="focus-ring inline-flex items-center gap-1 rounded-sm text-muted hover:text-foreground disabled:opacity-50 print:hidden"
            >
              <RefreshCw className={cn("h-3 w-3", draft.isPending && "animate-spin")} />
              Redraft
            </button>
            <button
              type="button"
              onClick={() => onNarrative(undefined)}
              className="focus-ring rounded-sm text-muted hover:text-foreground print:hidden"
            >
              Use the plain summary
            </button>
          </>
        ) : (
          <>
            <span className="flex-1">Written by Scry from the figures below.</span>
            {aiOn && (
              <button
                type="button"
                onClick={() => draft.mutate()}
                disabled={draft.isPending}
                className="focus-ring inline-flex items-center gap-1 rounded-sm text-muted hover:text-foreground disabled:opacity-50 print:hidden"
              >
                {draft.isPending ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {draft.isPending ? "Rewording…" : "Reword with AI"}
              </button>
            )}
          </>
        )}
      </div>
      {draft.error && <ErrorNote className="mt-3">{draft.error.message}</ErrorNote>}
    </div>
  );
}

function SourceChip({ r }: { r: BriefInitiativeRef }) {
  const { select } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => select(r.id)}
      title={`Open “${r.title}”`}
      className="focus-ring inline-flex max-w-56 items-center gap-1 rounded-md border border-border bg-background px-1.5 py-px text-[11px] text-muted hover:border-border-strong hover:text-foreground"
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_META[r.status].dot)} />
      <span className="truncate">{r.title}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function Decisions({ brief, name }: { brief: PortfolioBrief; name: (id: string) => string }) {
  if (brief.decisions.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing needs a decision: no open duplicates, no work several teams want without an owner,
        and nothing others build on has stalled.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-border/70 rounded-lg border border-border bg-surface print:border-neutral-300">
      {brief.decisions.map((d, i) => {
        const { icon: Icon, className } = KIND_STYLE[d.kind];
        return (
          <li
            key={`${d.kind}-${d.initiative.id}`}
            className="flex break-inside-avoid gap-3 px-4 py-3"
          >
            <span className="w-4 shrink-0 pt-0.5 text-right text-sm tabular-nums text-subtle">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  "mb-1 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
                  className,
                )}
              >
                <Icon className="h-3 w-3" />
                {DECISION_LABEL[d.kind]}
              </span>
              <p className="text-sm leading-relaxed text-foreground/90">
                <Sentence segments={decisionSentence(d, brief, name)} />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------

function MostWanted({ brief, name }: { brief: PortfolioBrief; name: (id: string) => string }) {
  if (brief.wanted.length === 0)
    return (
      <p className="text-sm text-muted">
        No team has asked for, or builds on, another team&apos;s work yet.
      </p>
    );
  return (
    <ul className="divide-y divide-border/70 rounded-lg border border-border bg-surface print:border-neutral-300">
      {brief.wanted.slice(0, 6).map((w) => (
        <li key={w.initiative.id} className="break-inside-avoid px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="min-w-0 text-sm">
              <Ref r={w.initiative} />
              <span className="text-muted"> · {name(w.initiative.teamId)}</span>
            </span>
            <StatusDot r={w.initiative} />
            <span className="ml-auto flex items-center gap-1.5">
              {w.uncommitted && w.teams > 0 && (
                <span className="rounded-sm bg-accent-2/10 px-1.5 py-0.5 text-[11px] font-medium text-accent-2">
                  Nobody has committed
                </span>
              )}
              <span className="rounded-sm bg-elevated px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground">
                {w.teams} {w.teams === 1 ? "team" : "teams"}
              </span>
            </span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {wantsByTeam(w.wants).map((x) => (
              <li
                key={x.teamId}
                className={cn(
                  "flex items-start gap-1.5 text-xs text-muted",
                  x.stale && "opacity-60",
                )}
              >
                <Avatar id={x.teamId} name={name(x.teamId)} size="xs" square />
                <span>
                  <span className="text-foreground/90">{name(x.teamId)}</span> {x.text}
                  {x.stale && (
                    <span className="text-subtle">
                      {" "}
                      · asked {formatDate(x.at)}, not confirmed since, so not counted
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function Emerging({ brief, name }: { brief: PortfolioBrief; name: (id: string) => string }) {
  if (brief.emerging.length === 0)
    return (
      <p className="text-sm text-muted">
        No theme has more than one new initiative in {periodPhrase(brief.days)}.
      </p>
    );
  return (
    <ul className="space-y-3">
      {brief.emerging.map((t) => (
        <li key={t.tag} className="break-inside-avoid">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-mono text-[13px] text-foreground">
              #{[t.tag, ...t.related].join(" #")}
            </span>
            <span className="text-xs text-muted">
              {t.count} {t.count === 1 ? "initiative" : "initiatives"}
            </span>
            {t.separate && (
              <span className="rounded-sm bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                {t.teamIds.length} teams, separately
              </span>
            )}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {t.initiatives.slice(0, 4).map((r, i) => (
              <span key={r.id}>
                {i > 0 && " · "}
                <Ref r={r} /> <span className="text-subtle">({name(r.teamId)})</span>
              </span>
            ))}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Newest({ brief, name }: { brief: PortfolioBrief; name: (id: string) => string }) {
  if (brief.newest.length === 0)
    return <p className="text-sm text-muted">Nothing new in {periodPhrase(brief.days)}.</p>;
  return (
    <ul className="space-y-2.5">
      {brief.newest.slice(0, 6).map((i) => (
        <li key={i.id} className="flex items-start gap-2.5">
          <Avatar id={i.teamId} name={name(i.teamId)} size="xs" square />
          <div className="min-w-0 flex-1 text-sm leading-snug">
            <Ref r={i} />
            <p className="text-xs text-subtle">
              {name(i.teamId)} · {shortDate(i.createdAt)}
              {i.tier === "strategic" && " · strategic"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function Changes({ brief, name }: { brief: PortfolioBrief; name: (id: string) => string }) {
  if (brief.changes.length === 0)
    return <p className="text-sm text-muted">Nothing changed in {periodPhrase(brief.days)}.</p>;
  return (
    <ul className="space-y-1.5">
      {brief.changes.slice(0, 10).map((c, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed text-foreground/90">
          <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-subtle">
            {shortDate(c.at)}
          </span>
          <span className="min-w-0">
            <Sentence segments={changeSentence(c, name)} />
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function StageBar({ counts }: { counts: Record<InitiativeStatus, number> }) {
  const total = STAGES.reduce((n, s) => n + counts[s], 0);
  if (!total) return <div className="h-2 rounded-full bg-elevated" />;
  return (
    <div
      className="flex h-2 gap-[2px] overflow-hidden rounded-full"
      role="img"
      aria-label={STAGES.filter((s) => counts[s])
        .map((s) => `${counts[s]} ${STATUS_META[s].label.toLowerCase()}`)
        .join(", ")}
    >
      {STAGES.filter((s) => counts[s]).map((s) => (
        <div
          key={s}
          className={STATUS_META[s].dot}
          style={{ width: `${(counts[s] / total) * 100}%` }}
          title={`${STATUS_META[s].label}: ${counts[s]}`}
        />
      ))}
    </div>
  );
}

function Numbers({ brief }: { brief: PortfolioBrief }) {
  const { navigate } = useWorkspace();
  const t = brief.totals;
  const delta = t.newPreviousPeriod === null ? null : t.newInPeriod - t.newPreviousPeriod;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        <span className="text-foreground">{t.live}</span> live ·{" "}
        <span className="text-foreground">{t.newInPeriod}</span> new
        {delta !== null && delta !== 0 && (
          <span className="text-subtle">
            {" "}
            ({delta > 0 ? "+" : "−"}
            {Math.abs(delta)} on the period before)
          </span>
        )}{" "}
        · <span className="text-foreground">{t.shippedInPeriod}</span> shipped ·{" "}
        <span className="text-foreground">{t.byStatus.on_hold}</span> on hold ·{" "}
        <span className="text-foreground">{t.goneQuiet}</span> gone quiet ·{" "}
        <span className="text-foreground">{t.openOverlaps}</span> possible{" "}
        {t.openOverlaps === 1 ? "duplicate" : "duplicates"}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface print:border-neutral-300">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-subtle">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Team
              </th>
              <th scope="col" className="w-[28%] px-4 py-2 font-medium">
                Mix
              </th>
              {["Live", "New", "On hold", "Shipped", "Wanted by"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {brief.teams.map((row) => (
              <tr key={row.teamId} className="break-inside-avoid">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => navigate({ view: "table", team: row.teamId })}
                    className="focus-ring flex items-center gap-2 rounded-sm text-foreground hover:underline"
                    title={`Open ${row.name}'s initiatives`}
                  >
                    <Avatar id={row.teamId} name={row.name} size="xs" square />
                    <span className="whitespace-nowrap">{row.name}</span>
                  </button>
                </th>
                <td className="px-4 py-2">
                  <StageBar counts={row.byStatus} />
                </td>
                <Num value={row.total} />
                <Num value={row.newInPeriod} />
                <Num value={row.byStatus.on_hold} tone="text-warning" />
                <Num value={row.shippedInPeriod} />
                <Num
                  value={row.demandTeams}
                  suffix={row.demandTeams ? (row.demandTeams === 1 ? " team" : " teams") : ""}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Num({ value, tone, suffix = "" }: { value: number; tone?: string; suffix?: string }) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 py-2 text-right tabular-nums",
        value ? (tone ?? "text-foreground") : "text-subtle",
      )}
    >
      {value ? `${value}${suffix}` : "–"}
    </td>
  );
}

// ---------------------------------------------------------------------------

export function BriefView() {
  const { url, navigate } = useWorkspace();
  const toast = useToast();
  const days = url.days === "" ? 90 : Number(url.days);
  const unit = url.unit;
  const {
    data: brief,
    isLoading,
    error,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.brief(days, unit),
    queryFn: () => api.brief(days, unit),
    placeholderData: (prev) => prev,
  });
  // AI rewordings are drafted on request and kept per period and scope.
  const [narratives, setNarratives] = useState<Record<string, BriefNarrative | undefined>>({});
  const narrative = narratives[`${days}|${unit}`];

  const teamName = useMemo(() => {
    const m = new Map(brief?.teams.map((t) => [t.teamId, t.name]));
    return (id: string) => m.get(id) ?? "another team";
  }, [brief]);
  // Teams outside the scoped org unit can still appear (as the team that
  // wants something), so fall back to the full team list for names.
  const { data: allTeams } = useTeams();
  const name = useMemo(() => {
    const m = new Map(allTeams?.map((t) => [t.id, t.name]));
    return (id: string) => m.get(id) ?? teamName(id);
  }, [allTeams, teamName]);

  const scope = unit || "Whole organisation";
  const title = `Portfolio brief · ${scope}`;

  const print = () => {
    const previous = document.title;
    document.title = `Scry ${title} · ${new Date().toISOString().slice(0, 10)}`;
    window.print();
    document.title = previous;
  };
  const copyText = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(briefAsText(brief, narrative, name));
      toast({ tone: "success", message: "Copied as text — ready for an email or chat" });
    } catch {
      toast({ tone: "error", message: "Couldn't access the clipboard" });
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-8 print:max-w-none print:p-0">
      {/* Controls — screen only */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div
          className="inline-flex rounded-lg border border-border bg-surface p-0.5"
          role="radiogroup"
          aria-label="Period"
        >
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              role="radio"
              aria-checked={days === p.days}
              onClick={() =>
                navigate({ days: p.days === 90 ? "" : String(p.days) }, { replace: true })
              }
              className={cn(
                "focus-ring rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                days === p.days
                  ? "bg-elevated text-foreground shadow-card"
                  : "text-muted hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {(brief?.orgUnits.length ?? 0) > 0 && (
          <Select
            filter
            aria-label="Scope"
            icon={<Building2 className="h-3.5 w-3.5" />}
            value={unit}
            onChange={(e) => navigate({ unit: e.target.value }, { replace: true })}
          >
            <option value="">Whole organisation</option>
            {brief?.orgUnits.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        )}
        {isFetching && !isLoading && <Spinner className="h-3.5 w-3.5 text-subtle" />}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={copyText} disabled={!brief}>
            <Copy className="h-3.5 w-3.5" />
            Copy as text
          </Button>
          <Button size="sm" onClick={print} disabled={!brief}>
            <Printer className="h-3.5 w-3.5" />
            Print or save PDF
          </Button>
        </div>
      </div>

      {error && <ErrorNote>Couldn&apos;t build the brief: {error.message}</ErrorNote>}

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-28" />
          <Skeleton className="h-48" />
        </div>
      )}

      {brief && brief.totals.live === 0 && (
        <EmptyState
          icon={<Layers className="h-5 w-5" />}
          title="Nothing to report yet"
          description={
            unit
              ? `No initiatives are registered for teams in ${unit}.`
              : "Once teams register what they're working on, the brief builds itself."
          }
        />
      )}

      {brief && brief.totals.live > 0 && (
        <article className="flex flex-col gap-8 print:block print:space-y-5" aria-label={title}>
          <header>
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-subtle">
              <FileText className="h-3.5 w-3.5" />
              Portfolio brief
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
              {scope}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {periodPhrase(brief.days).replace(/^./, (c) => c.toUpperCase())} · {brief.totals.live}{" "}
              live initiatives across {brief.teams.length} teams · as of{" "}
              {new Date(brief.generatedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </header>

          <Summary
            brief={brief}
            days={days}
            unit={unit}
            narrative={narrative}
            onNarrative={(n) => setNarratives((all) => ({ ...all, [`${days}|${unit}`]: n }))}
          />

          <Section
            title="Decisions for you"
            description="At most five, most important first. Each names who to talk to."
          >
            <Decisions brief={brief} name={name} />
          </Section>

          <Section
            title="Most wanted"
            keepTogether
            description={`Work other teams asked for or build on. Each team counts once; requests not confirmed for ${Math.round(DEMAND_STALE_AFTER_DAYS / 30)} months fade.`}
          >
            <MostWanted brief={brief} name={name} />
          </Section>

          <Section
            title="What's emerging"
            keepTogether
            description={
              brief.days
                ? "Themes new work clusters around. Several teams starting on the same theme separately is the earliest sign of overlap."
                : "Themes open work clusters around, and where several teams work on the same one."
            }
          >
            <div className="grid gap-8 lg:grid-cols-[3fr_2fr] print:grid-cols-[3fr_2fr]">
              <Emerging brief={brief} name={name} />
              <div>
                <h3 className="mb-3 text-xs font-medium text-subtle">
                  Newest {brief.days ? `in ${periodPhrase(brief.days).replace("the ", "")}` : ""}
                </h3>
                <Newest brief={brief} name={name} />
              </div>
            </div>
          </Section>

          {brief.days !== null && (
            <Section
              title="What changed"
              keepTogether
              description="Duplicates resolved, new demand, and work that moved forward or shipped."
            >
              <Changes brief={brief} name={name} />
            </Section>
          )}

          <Section title="The numbers" keepTogether>
            <Numbers brief={brief} />
          </Section>

          <footer className="border-t border-border pt-4 text-xs text-subtle">
            Generated by Scry from the idea bank on {formatDate(brief.generatedAt.slice(0, 10))}.
            Counts include every live initiative; cancelled ones and duplicates merged into another
            are left out. “Gone quiet” means planned or in progress with no update for 45 days.
          </footer>
        </article>
      )}
    </div>
  );
}
