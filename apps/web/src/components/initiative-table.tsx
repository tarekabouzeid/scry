"use client";

import { useEffect, useMemo, useState } from "react";
import {
  columnVisibilityFeature,
  createColumnHelper,
  flexRender,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  PauseCircle,
  HandHeart,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  CircleDot,
  FileUp,
  Layers,
  Rocket,
  Rows2,
  Rows4,
  Search,
  SearchX,
  Target,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  INITIATIVE_STATUSES,
  INITIATIVE_TIERS,
  type Initiative,
  type InitiativeSort,
} from "@scry/shared";
import { cn } from "@/lib/cn";
import {
  useInitiativeCounts,
  useInitiativePages,
  useInitiativesById,
  useOverlapCount,
  useOverlapIndex,
  useOverlapsFor,
  useTeamLookup,
  useTeams,
} from "@/lib/queries";
import { nextTableSort, parseTableSort } from "@/lib/table-sort";
import { useDebounced } from "@/lib/use-debounced";
import { STATUS_META, TIER_LABEL, formatDate, relativeTime } from "@/lib/format";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { StatusBadge, TierBadge } from "./ui/badge";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import { EmptyState, ErrorNote, Kbd, Skeleton } from "./ui/feedback";
import { ImportDialog } from "./import-dialog";
import { useWorkspace } from "./workspace";
import { SavedViewsMenu } from "./saved-views";
import { usePref } from "@/lib/prefs";

// The api pages and sorts; the table only renders rows and hides columns.
const features = tableFeatures({ columnVisibilityFeature });
const columnHelper = createColumnHelper<typeof features, Initiative>();

// TanStack Table recomputes (and auto-resets its page index, re-rendering)
// whenever `data` changes identity. A fresh `[]` on every render while the
// list loads turned that into an endless loop that starved the network
// callbacks and froze the page on its skeleton. Keep "no data" one array.
/** The api returns the strongest this many open overlaps for review. */
const REVIEW_LIMIT = 100;

const NO_ROWS: Initiative[] = [];
const NO_IDS: string[] = [];

const PAGE_SIZE = 50;

/** The columns the api can sort by (each has an index); the rest aren't sortable. */
const SORTABLE = new Set<string>(["title", "status", "target", "updated"]);

/** Overlap review filters client-side: it's a short list fetched by id. */
function matchesFilters(
  i: Initiative,
  f: { search: string; teamId: string; status: string; tier: string },
) {
  if (f.teamId && i.teamId !== f.teamId) return false;
  if (f.status && i.status !== f.status) return false;
  if (f.tier && i.tier !== f.tier) return false;
  const text = `${i.title} ${i.summary}`.toLowerCase();
  return f.search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: string;
  loading: boolean;
}) {
  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong">
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40",
          tone,
        )}
      />
      {/* Values sit on one baseline even when a narrow card wraps its label. */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium leading-snug text-muted">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-subtle" />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <p className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
      )}
    </div>
  );
}

type ColumnMeta = { className?: string };

export function InitiativeTable() {
  const { url, navigate, select, openCreate } = useWorkspace();
  const panelOpen = !!url.i;
  const selectedId = url.i;
  const onSelect = (initiative: Initiative) => select(initiative.id);
  // Filters live in the URL so a filtered view is a shareable link. Typing
  // stays local and is debounced into the URL (replace, not push).
  const [search, setSearch] = useState(url.q);
  const { team: teamId, status, tier } = url;
  const setFilter = (patch: Partial<typeof url>) => navigate(patch, { replace: true });
  // Sorting happens in the api (on indexed columns), so it lives in the URL too.
  const order = parseTableSort(url.sort, url.dir);
  const sortBy = (column: InitiativeSort) =>
    navigate(nextTableSort(order, column), { replace: true });
  const [overlapsOnly, setOverlapsOnly] = useState(false);
  const [importing, setImporting] = useState(false);
  const debouncedSearch = useDebounced(search.trim());
  useEffect(() => {
    if (debouncedSearch !== url.q) navigate({ q: debouncedSearch }, { replace: true });
  }, [debouncedSearch, url.q, navigate]);
  // Keep the box in sync when the URL changes underneath us (back button, ⌘K).
  useEffect(() => setSearch((s) => (s.trim() === url.q ? s : url.q)), [url.q]);
  // Reviewing overlaps walks the strongest ones; row markers ask about the rows shown.
  const reviewIndex = useOverlapIndex();
  const openOverlaps = useOverlapCount();
  const [density, setDensity] = usePref<"comfortable" | "compact">("scry-density", "comfortable");
  const compact = density === "compact";

  const { data: teams } = useTeams();
  const teamOf = useTeamLookup();
  // The cards count the whole register; the result count follows the filters.
  const { counts: everything, isLoading: statsLoading } = useInitiativeCounts("status");
  const filters = { search: debouncedSearch, teamId, status, tier };
  const { counts: matching } = useInitiativeCounts("status", filters);
  const hasFilters = Object.values(filters).some(Boolean) || overlapsOnly;

  const list = useInitiativePages(
    { ...filters, sort: order.sort, dir: order.dir, limit: PAGE_SIZE },
    { enabled: !overlapsOnly },
  );
  // Reviewing overlaps: the few initiatives involved, fetched by id.
  const overlapIds = useMemo(() => [...reviewIndex.keys()], [reviewIndex]);
  const overlapOf = useInitiativesById(overlapsOnly ? overlapIds : NO_IDS);
  const listed = list.data?.pages;
  const initiatives = useMemo(() => {
    if (overlapsOnly) {
      return overlapIds
        .map((id) => overlapOf(id))
        .filter((i): i is Initiative => !!i && matchesFilters(i, filters));
    }
    return listed?.flatMap((page) => page.items);
    // `filters` is rebuilt every render; its parts are the real inputs.
  }, [overlapsOnly, overlapIds, overlapOf, listed, debouncedSearch, teamId, status, tier]);
  const isLoading = overlapsOnly ? overlapOf.isLoading : list.isLoading;
  const { isFetching, error } = list;
  const resultCount = overlapsOnly ? initiatives?.length : list.data ? matching.total : undefined;
  const shownIds = useMemo(() => (initiatives ?? []).map((i) => i.id), [initiatives]);
  const overlapIndex = useOverlapsFor(shownIds);
  const overlapCount = openOverlaps;

  const stats = {
    total: everything.total,
    active: everything.of("in_progress") + everything.of("planned"),
    onHold: everything.of("on_hold"),
    shipped: everything.of("shipped"),
  };

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("title", {
          header: "Initiative",
          cell: (info) => {
            const i = info.row.original;
            return (
              <div
                className={cn(
                  "min-w-0 max-w-56",
                  // Narrower beside the detail panel, so Team and Status still fit.
                  panelOpen ? "sm:max-w-[16rem] xl:max-w-[20rem]" : "sm:max-w-88 xl:max-w-104",
                )}
              >
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <span className="truncate">{i.title}</span>
                  {overlapIndex.has(i.id) && (
                    <span
                      title="Possible overlap with another team's initiative"
                      className="shrink-0"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    </span>
                  )}
                  {!!i.signalTeams && (
                    <span
                      title={`Also needed by ${i.signalTeams} other team${i.signalTeams === 1 ? "" : "s"}`}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent-2/10 px-1.5 text-[10px] font-medium text-accent-2"
                    >
                      <HandHeart className="h-3 w-3" />
                      {i.signalTeams}
                    </span>
                  )}
                  {i.mergedIntoId && (
                    <span className="shrink-0 rounded-full bg-elevated px-1.5 text-[10px] font-medium text-subtle">
                      Merged
                    </span>
                  )}
                </p>
                {!compact && (
                  <p
                    className="truncate text-xs text-subtle"
                    title={i.tldr ? i.summary : undefined}
                  >
                    {i.tldr ?? i.summary}
                  </p>
                )}
              </div>
            );
          },
        }),
        columnHelper.accessor((row) => teamOf(row.teamId)?.name ?? "", {
          id: "team",
          header: "Team",
          meta: { className: "hidden sm:table-cell" } satisfies ColumnMeta,
          cell: (info) => {
            const id = info.row.original.teamId;
            const name = info.getValue() || "Unknown team";
            return (
              <span className="flex items-center gap-2 whitespace-nowrap text-muted">
                <Avatar id={id} name={name} size="sm" square />
                {name}
              </span>
            );
          },
        }),
        columnHelper.accessor("status", {
          header: "Status",
          cell: (info) => <StatusBadge status={info.getValue()} />,
        }),
        columnHelper.accessor("tier", {
          header: "Tier",
          meta: { className: "hidden lg:table-cell" } satisfies ColumnMeta,
          cell: (info) => <TierBadge tier={info.getValue()} />,
        }),
        // Column ids match the api's sort names (InitiativeSort).
        columnHelper.accessor("targetDate", {
          id: "target",
          header: "Target",
          meta: { className: "hidden md:table-cell" } satisfies ColumnMeta,
          cell: (info) => {
            const value = info.getValue();
            return value ? (
              <span className="whitespace-nowrap tabular-nums text-muted">{formatDate(value)}</span>
            ) : (
              <span className="text-subtle">—</span>
            );
          },
        }),
        columnHelper.accessor("updatedAt", {
          id: "updated",
          header: "Updated",
          meta: { className: "hidden xl:table-cell" } satisfies ColumnMeta,
          cell: (info) => (
            <span
              className="whitespace-nowrap text-subtle"
              title={new Date(info.getValue()).toLocaleString()}
            >
              {relativeTime(info.getValue())}
            </span>
          ),
        }),
      ]),
    [teamOf, overlapIndex, panelOpen, compact],
  );

  const table = useTable({
    features,
    data: initiatives ?? NO_ROWS,
    columns,
    // With the detail panel open the table loses ~27rem; viewport breakpoints
    // don't know that, so drop the secondary columns rather than clip them.
    state: {
      columnVisibility: panelOpen ? { tier: false, target: false, updated: false } : {},
    },
  });

  const clearFilters = () => {
    setSearch("");
    setOverlapsOnly(false);
    setFilter({ q: "", team: "", status: "", tier: "" });
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total initiatives"
          value={stats.total}
          icon={Layers}
          tone="bg-accent"
          loading={statsLoading}
        />
        <StatCard
          label="Planned & in progress"
          value={stats.active}
          icon={CircleDot}
          tone="bg-status-progress"
          loading={statsLoading}
        />
        <StatCard
          label="On hold"
          value={stats.onHold}
          icon={PauseCircle}
          tone="bg-warning"
          loading={statsLoading}
        />
        <StatCard
          label="Shipped"
          value={stats.shipped}
          icon={Rocket}
          tone="bg-status-shipped"
          loading={statsLoading}
        />
      </div>

      {overlapCount > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 sm:flex-row sm:items-center">
          <AlertTriangle className="hidden h-5 w-5 shrink-0 text-warning sm:block" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {overlapCount} possible cross-team overlap{overlapCount === 1 ? "" : "s"} to review
            </p>
            <p className="text-xs text-muted">
              Scry found initiatives from different teams that look like the same work. Merge them,
              mark them as related, or say they&apos;re not duplicates.
              {overlapCount > REVIEW_LIMIT && ` Reviewing the strongest ${REVIEW_LIMIT} first.`}
            </p>
          </div>
          <Button size="sm" onClick={() => setOverlapsOnly((v) => !v)}>
            {overlapsOnly ? "Show all" : "Review overlaps"}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          icon={<Search className="h-4 w-4" />}
          placeholder="Search titles and summaries…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
          trailing={
            search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-subtle hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : undefined
          }
        />
        <Select
          filter
          icon={<Users className="h-3.5 w-3.5" />}
          value={teamId}
          onChange={(e) => setFilter({ team: e.target.value })}
        >
          <option value="">All teams</option>
          {teams?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select
          filter
          icon={<CircleDot className="h-3.5 w-3.5" />}
          value={status}
          onChange={(e) => setFilter({ status: e.target.value })}
        >
          <option value="">All statuses</option>
          {INITIATIVE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
        <Select
          filter
          icon={<Target className="h-3.5 w-3.5" />}
          value={tier}
          onChange={(e) => setFilter({ tier: e.target.value })}
        >
          <option value="">All tiers</option>
          {INITIATIVE_TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </Select>
        {(hasFilters || search) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
        <p className="ml-auto text-xs text-subtle">
          {resultCount !== undefined ? `${resultCount} result${resultCount === 1 ? "" : "s"}` : ""}
        </p>
        <SavedViewsMenu />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setDensity(compact ? "comfortable" : "compact")}
          title={compact ? "Comfortable rows" : "Compact rows"}
          aria-label={compact ? "Comfortable rows" : "Compact rows"}
          aria-pressed={compact}
        >
          {compact ? <Rows2 className="h-4 w-4" /> : <Rows4 className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setImporting(true)}
          title="Import CSV"
          aria-label="Import CSV"
        >
          <FileUp className="h-4 w-4" />
        </Button>
      </div>

      {error && <ErrorNote>Couldn&apos;t load initiatives: {error.message}</ErrorNote>}

      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-surface shadow-card transition-opacity",
          isFetching && !isLoading && "opacity-70",
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-elevated/50 text-left">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const id = header.column.id;
                    const sortable = SORTABLE.has(id) && !overlapsOnly;
                    const sorted = sortable && order.sort === id ? order.dir : false;
                    const SortIcon =
                      sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
                    const label = flexRender(header.column.columnDef.header, header.getContext());
                    return (
                      <th
                        key={header.id}
                        // Without scope, Chromium can expose these as plain cells,
                        // and aria-sort is only read out on column headers.
                        scope="col"
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : undefined
                        }
                        className={cn(
                          "px-4 py-2.5 font-medium",
                          (header.column.columnDef.meta as ColumnMeta | undefined)?.className,
                        )}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => sortBy(id as InitiativeSort)}
                            className={cn(
                              "focus-ring -mx-1 inline-flex items-center gap-1 rounded-sm px-1 text-xs uppercase tracking-wider transition-colors",
                              sorted ? "text-foreground" : "text-subtle hover:text-muted",
                            )}
                          >
                            {label}
                            <SortIcon className={cn("h-3 w-3", !sorted && "opacity-50")} />
                          </button>
                        ) : (
                          <span className="text-xs uppercase tracking-wider text-subtle">
                            {label}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border/70">
              {isLoading &&
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-64" />
                      <Skeleton className="mt-1.5 h-3 w-40" />
                    </td>
                    {Array.from({ length: columns.length - 1 }, (_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))}
              {table.getRowModel().rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  data-tour={rowIndex === 0 ? "first-initiative" : undefined}
                  tabIndex={0}
                  onClick={() => onSelect(row.original)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(row.original);
                    }
                  }}
                  className={cn(
                    "group cursor-pointer outline-hidden transition-colors hover:bg-elevated/60 focus-visible:bg-elevated",
                    selectedId === row.original.id && "bg-accent/6 hover:bg-accent/10",
                  )}
                >
                  {row.getVisibleCells().map((cell, idx) => (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-4",
                        compact ? "py-1.5" : "py-3",
                        (cell.column.columnDef.meta as ColumnMeta | undefined)?.className,
                        idx === 0 &&
                          selectedId === row.original.id &&
                          "shadow-[inset_2px_0_0_rgb(var(--accent))]",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && (initiatives?.length ?? 0) === 0 && (
          <EmptyState
            icon={hasFilters ? <SearchX className="h-5 w-5" /> : <Layers className="h-5 w-5" />}
            title={hasFilters ? "No initiatives match these filters" : "No initiatives yet"}
            description={
              hasFilters
                ? "Try a broader search, or clear the filters."
                : "Register your team's work so everyone can see it — or import your roadmap."
            }
            action={
              hasFilters ? (
                <Button size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => openCreate()}>
                    New initiative
                  </Button>
                  <Button size="sm" onClick={() => setImporting(true)}>
                    <FileUp className="h-3.5 w-3.5" />
                    Import CSV
                  </Button>
                </div>
              )
            }
          />
        )}

        {!overlapsOnly && list.hasNextPage && (
          <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-3">
            <span className="text-xs text-subtle">
              Showing {initiatives?.length ?? 0} of {matching.total}
            </span>
            <Button
              size="sm"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      <p className="hidden items-center gap-1.5 text-xs text-subtle sm:flex">
        Tip: press <Kbd>C</Kbd> to add an initiative, <Kbd>⌘K</Kbd> to jump anywhere, <Kbd>Esc</Kbd>{" "}
        to close the details panel.
      </p>
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
