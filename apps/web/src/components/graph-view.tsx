"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import {
  Check,
  Crosshair,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  Search,
  Users,
  Waypoints,
  X,
} from "lucide-react";
import {
  INITIATIVE_STATUSES,
  type GraphTeamDetail,
  type Initiative,
  type InitiativeStatus,
} from "@scry/shared";
import { api, searchStreamUrl } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  queryKeys,
  useInitiativePage,
  useInitiativesById,
  useLlmStatus,
  useTeams,
} from "@/lib/queries";
import { EDGE_LABEL, STATUS_META, hexFor } from "@/lib/format";
import {
  NODE_SPACING,
  buildScene,
  fitCircles,
  initiativeKey,
  layoutTeams,
  pickOpenTeams,
  placeLabels,
  prepareOpenTeam,
  sameSet,
  teamKey,
  teamCircleRadius,
  type Circle,
  type InitiativeNode,
  type LabelBox,
  type OpenTeam,
  type Point,
  type SceneLink,
  type SceneNode,
  type Transform,
} from "@/lib/graph-map";
import { useDebounced } from "@/lib/use-debounced";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { useWorkspace } from "./workspace";
import { EmptyState, ErrorNote, Spinner } from "./ui/feedback";
import type { GraphHandle } from "./force-graph-canvas";

const ForceGraphCanvas = dynamic(() => import("./force-graph-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  ),
});

/** Canvas can't use CSS classes — resolve the theme tokens to rgba() strings. */
function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const rgb = (name: string, alpha: number) =>
    `rgba(${css.getPropertyValue(`--${name}`).trim().split(/\s+/).join(", ")}, ${alpha})`;
  return {
    accent: rgb("accent", 1),
    label: rgb("foreground", 0.95),
    labelMuted: rgb("foreground", 0.7),
    labelBg: rgb("background", 0.82),
    background: rgb("background", 1),
    core: rgb("background", 0.35),
    ring: rgb("foreground", 0.85),
  };
}

/** Palette that updates when the theme (data-theme on <html>) changes. */
function usePalette() {
  const [palette, setPalette] = useState<ReturnType<typeof readPalette> | null>(null);
  useEffect(() => {
    setPalette(readPalette());
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return palette;
}

type SearchPhase = "idle" | "embedding" | "vector_search" | "graph_expand" | "done" | "error";

const PHASES: { id: Exclude<SearchPhase, "idle" | "done" | "error">; label: string }[] = [
  { id: "embedding", label: "Embedding" },
  { id: "vector_search", label: "Semantic search" },
  { id: "graph_expand", label: "Graph expand" },
];

/** How close "fit" and "go to a team" zoom at most; hand zooming goes further. */
const FIT_MAX_ZOOM = 2.5;
const TEAM_MAX_ZOOM = 3.5;
/** Zoom at which initiatives are far enough apart to label. */
const LABEL_ZOOM = 34 / NODE_SPACING;
const CAMERA_MS = 600;

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function PhaseStepper({ phase }: { phase: SearchPhase }) {
  const activeIndex = phase === "done" ? PHASES.length : PHASES.findIndex((p) => p.id === phase);
  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, i) => {
        const complete = i < activeIndex;
        const active = i === activeIndex;
        return (
          <div key={p.id} className="flex items-center gap-1">
            {i > 0 && (
              <span
                className={cn(
                  "h-px w-3 transition-colors",
                  complete || active ? "bg-accent/60" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors",
                active && "bg-accent/15 text-accent",
                complete && "text-muted",
                !active && !complete && "text-subtle",
              )}
            >
              {complete ? (
                <Check className="h-3 w-3 text-status-shipped" />
              ) : active ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
              )}
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Search initiatives by title to go to one on the map. */
function CentrePicker({ onPick }: { onPick: (initiative: Initiative) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const search = useDebounced(query.trim());
  const { data } = useInitiativePage({ search, limit: 8 }, { enabled: open && !!search });
  const matches = search ? (data?.items ?? []) : [];
  return (
    <div className="relative">
      <Input
        icon={<Crosshair className="h-4 w-4" />}
        placeholder="Go to an initiative…"
        aria-label="Go to an initiative"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-72 border-transparent bg-background/60"
      />
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Initiatives"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-pop"
        >
          {matches.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(i);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-elevated"
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_META[i.status].dot)} />
                <span className="truncate">{i.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Canvas text is measured a lot while zooming; widths don't change per font.
const textWidths = new Map<string, number>();
function measure(ctx: CanvasRenderingContext2D, text: string): number {
  const key = `${ctx.font}|${text}`;
  let w = textWidths.get(key);
  if (w === undefined) {
    if (textWidths.size > 20_000) textWidths.clear();
    w = ctx.measureText(text).width;
    textWidths.set(key, w);
  }
  return w;
}

/** The text, shortened with "…" to fit `max` px in the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string | null {
  if (measure(ctx, text) <= max) return text;
  let n = Math.floor((text.length * max) / measure(ctx, text));
  while (n > 3) {
    const cut = `${text.slice(0, n).trimEnd()}…`;
    if (measure(ctx, cut) <= max) return cut;
    n -= 2;
  }
  return null;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

function nodeName(node: SceneNode | undefined): string {
  if (!node) return "";
  return node.kind === "team" ? node.team.name : node.name;
}

/** "Growth builds on Data & ML" (· 3 relationships) — how a line reads. */
function describeLink(link: SceneLink, nodes: Map<string, SceneNode>): string {
  const from = nodeName(nodes.get(link.source));
  const to = nodeName(nodes.get(link.target));
  const sentence =
    link.type === "related"
      ? `${from} and ${to} are related`
      : `${from} ${link.type === "builds_on" ? "builds on" : "replaces"} ${to}`;
  return link.count > 1 ? `${sentence} · ${plural(link.count, "relationship")}` : sentence;
}

type Hover = { kind: "node"; id: string } | { kind: "link"; id: string } | null;

export function GraphView({
  onSelect,
  selectedId,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const { url, navigate } = useWorkspace();
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const graphRef = useRef<GraphHandle | undefined>(undefined);
  const [graphReady, setGraphReady] = useState(false);
  const markReady = useCallback(() => setGraphReady(true), []);
  const palette = usePalette();
  const { data: llmStatus } = useLlmStatus();
  const { data: teamList } = useTeams();

  // ------------------------------------------------------------ the map
  const {
    data: overview,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.graphOverview,
    queryFn: api.graphOverview,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const teams = useMemo(() => overview?.teams ?? [], [overview]);
  const teamLimit = overview?.teamLimit ?? 200;
  const shownOf = useCallback((total: number) => Math.min(total, teamLimit), [teamLimit]);

  // Laid out once per change in the data, starting from the last picture so
  // a refresh (someone added an initiative) barely moves anything.
  const lastLayout = useRef<Map<string, Point> | undefined>(undefined);
  const circles = useMemo(() => {
    const weights = new Map<string, number>();
    for (const l of overview?.links ?? []) {
      const key = [l.fromTeamId, l.toTeamId].sort().join("|");
      weights.set(key, (weights.get(key) ?? 0) + l.count);
    }
    const layout = layoutTeams(
      teams.map((t) => ({ id: t.id, orgUnit: t.orgUnit, r: teamCircleRadius(t.total, teamLimit) })),
      [...weights].map(([key, weight]) => {
        const [a, b] = key.split("|") as [string, string];
        return { a, b, weight: Math.log2(1 + weight) };
      }),
      lastLayout.current,
    );
    lastLayout.current = layout;
    return layout;
  }, [teams, overview, teamLimit]);

  // ------------------------------------------------- which teams are open
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const openRef = useRef(openIds);
  openRef.current = openIds;
  const transformRef = useRef<Transform>({ k: 1, x: 0, y: 0 });
  const [zoomK, setZoomK] = useState(1);

  const pickable = useMemo(
    () =>
      teams.flatMap((t) => {
        const circle = circles.get(t.id);
        return circle ? [{ id: t.id, circle, shown: shownOf(t.total) }] : [];
      }),
    [teams, circles, shownOf],
  );
  const evaluate = useCallback(() => {
    if (!size.width || !size.height) return;
    const g = graphRef.current;
    if (g) {
      const k = g.zoom();
      const c = g.centerAt();
      transformRef.current = { k, x: size.width / 2 - c.x * k, y: size.height / 2 - c.y * k };
    }
    const t = transformRef.current;
    const next = pickOpenTeams(pickable, t, size, openRef.current);
    if (!sameSet(next, openRef.current)) setOpenIds(next);
    // Arrowheads are sized in world units; keep them readable at any zoom,
    // re-rendering only when the zoom has changed noticeably.
    setZoomK((k) => (Math.abs(Math.log2(t.k / k)) > 0.25 ? t.k : k));
  }, [pickable, size]);
  const evaluateRef = useRef(evaluate);
  evaluateRef.current = evaluate;
  useEffect(() => evaluate(), [evaluate]);

  const throttle = useRef<number | null>(null);
  // force-graph's zoom events carry the world point at the view's centre,
  // not the pan offset, so re-read the camera from the graph instead.
  const onZoom = useCallback(() => {
    if (throttle.current !== null) return;
    throttle.current = window.setTimeout(() => {
      throttle.current = null;
      evaluateRef.current();
    }, 120);
  }, []);
  useEffect(() => () => void (throttle.current && clearTimeout(throttle.current)), []);

  const openList = useMemo(() => [...openIds].sort(), [openIds]);
  const details = useQueries({
    queries: openList.map((id) => ({
      queryKey: queryKeys.graphTeam(id),
      queryFn: () => api.graphTeam(id),
      staleTime: 30_000,
    })),
  });
  const detailSignature = details.map((d) => d.dataUpdatedAt).join(",");
  const loadedDetails = useMemo(
    () => details.flatMap((d) => (d.data ? [d.data] : [])) as GraphTeamDetail[],
    // `details` is a fresh array each render; its data only changes with this.
    [detailSignature, openList],
  );
  const loadingTeams = useMemo(
    () => new Set(openList.filter((_, i) => details[i]?.isPending)),
    [openList, detailSignature],
  );

  // Lay out each open team once per (detail, map) pair.
  const openCache = useRef(
    new Map<string, { detail: GraphTeamDetail; circles: Map<string, Circle>; open: OpenTeam }>(),
  );
  const openTeams = useMemo(() => {
    const out = new Map<string, OpenTeam>();
    for (const detail of loadedDetails) {
      if (!circles.has(detail.teamId)) continue;
      const hit = openCache.current.get(detail.teamId);
      const open =
        hit && hit.detail === detail && hit.circles === circles
          ? hit.open
          : prepareOpenTeam(detail, circles);
      openCache.current.set(detail.teamId, { detail, circles, open });
      out.set(detail.teamId, open);
    }
    return out;
  }, [loadedDetails, circles]);

  const scene = useMemo(
    () => buildScene(teams, overview?.links ?? [], circles, openTeams),
    [teams, overview, circles, openTeams],
  );
  const nodeById = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene]);
  const graphData = useMemo(
    () => ({
      // Fixed positions: the layout is computed, not simulated, so nothing drifts.
      nodes: scene.nodes.map((n) => ({ ...n, fx: n.x, fy: n.y })),
      links: scene.links.map((l) => ({ ...l })),
    }),
    [scene],
  );

  // ---------------------------------------------------------------- camera
  const [fitted, setFitted] = useState(false);
  // The toolbar floats over the top of the canvas: framing keeps below it.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const clearTop = useCallback(() => {
    const bar = toolbarRef.current;
    return bar ? Math.max(0, bar.offsetTop + bar.offsetHeight - 24) : 0;
  }, []);
  const cameraTo = useCallback((target: { cx: number; cy: number; k: number }, ms = CAMERA_MS) => {
    const g = graphRef.current;
    if (!g) return;
    // One move: centre and zoom animate together, from wherever we are.
    g.centerAt(target.cx, target.cy, ms);
    g.zoom(target.k, ms);
  }, []);
  const fitAll = useCallback(
    (ms = CAMERA_MS) => {
      if (!circles.size || !size.width) return;
      cameraTo(fitCircles([...circles.values()], size, 48, FIT_MAX_ZOOM, clearTop()), ms);
    },
    [circles, size, cameraTo],
  );
  const focusTeam = useCallback(
    (teamId: string) => {
      const circle = circles.get(teamId);
      if (circle && size.width) cameraTo(fitCircles([circle], size, 64, TEAM_MAX_ZOOM, clearTop()));
    },
    [circles, size, cameraTo],
  );

  // Going to an initiative: open its team first, then centre on it once
  // it's drawn. A click on the canvas never moves the camera.
  const pending = useRef<{ id: string; teamId: string } | null>(null);
  const focusInitiative = useCallback(
    (id: string, teamId: string) => {
      const node = nodeById.get(initiativeKey(id));
      if (node) {
        const k = Math.min(Math.max(transformRef.current.k, LABEL_ZOOM * 1.4), 6);
        cameraTo({ cx: node.x, cy: node.y, k });
        pending.current = null;
      } else {
        pending.current = { id, teamId };
        focusTeam(teamId);
      }
    },
    [nodeById, cameraTo, focusTeam],
  );
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    if (nodeById.has(initiativeKey(p.id))) focusInitiative(p.id, p.teamId);
    // Its team is open but it isn't drawn (capped or merged): the team is framed.
    else if (openTeams.has(p.teamId)) pending.current = null;
  }, [nodeById, openTeams, focusInitiative]);

  // First frame: fit the whole organisation, instantly. The canvas stays
  // hidden until then, so there's no jump from force-graph's own default.
  useEffect(() => {
    if (fitted || !graphReady || !circles.size || !size.width) return;
    const fit = fitCircles([...circles.values()], size, 48, FIT_MAX_ZOOM, clearTop());
    cameraTo(fit, 0);
    transformRef.current = { k: fit.k, x: fit.x, y: fit.y };
    evaluateRef.current();
    setFitted(true);
  }, [fitted, graphReady, circles, size, cameraTo]);

  // Where to go after the first fit: the selected initiative, else the team in the link.
  const selectedLookup = useInitiativesById([selectedId]);
  const selectedTeam =
    (selectedId &&
      (nodeById.get(initiativeKey(selectedId)) as InitiativeNode | undefined)?.teamId) ||
    (selectedId ? selectedLookup(selectedId)?.teamId : undefined);
  const clicked = useRef<string | null>(null);
  const startedAt = useRef(false);
  useEffect(() => {
    if (!fitted || startedAt.current) return;
    if (selectedId && !selectedTeam) return; // wait for its team
    startedAt.current = true;
    if (selectedId && selectedTeam) focusInitiative(selectedId, selectedTeam);
    else if (url.team && circles.has(url.team)) focusTeam(url.team);
    // Only once, after the first fit.
  }, [fitted, selectedTeam]);

  // Selected from elsewhere (the details panel, a match): bring it into view
  // if it isn't already. Not when it was clicked on the canvas.
  const lastSelected = useRef(selectedId);
  useEffect(() => {
    if (!startedAt.current || selectedId === lastSelected.current) return;
    if (!selectedId) {
      lastSelected.current = null;
      return;
    }
    if (clicked.current === selectedId) {
      lastSelected.current = selectedId;
      clicked.current = null;
      return;
    }
    if (!selectedTeam) return; // wait for its team
    lastSelected.current = selectedId;
    const node = nodeById.get(initiativeKey(selectedId));
    if (node) {
      const t = transformRef.current;
      const sx = node.x * t.k + t.x;
      const sy = node.y * t.k + t.y;
      const onScreen = sx > 40 && sx < size.width - 40 && sy > 40 && sy < size.height - 40;
      if (onScreen && t.k >= LABEL_ZOOM) return;
    }
    focusInitiative(selectedId, selectedTeam);
  }, [selectedId, selectedTeam, nodeById, size, focusInitiative]);

  // ---------------------------------------------------------------- search
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [matches, setMatches] = useState<Array<{ id: string; title: string; teamId: string }>>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const clearSearch = useCallback(() => {
    eventSourceRef.current?.close();
    setPhase("idle");
    setHighlighted(new Set());
    setMatches([]);
  }, []);

  const runSearch = useCallback(
    (q: string) => {
      eventSourceRef.current?.close();
      if (!q.trim()) {
        clearSearch();
        return;
      }

      const es = new EventSource(searchStreamUrl(q.trim()), { withCredentials: true });
      eventSourceRef.current = es;
      setHighlighted(new Set());
      setMatches([]);
      setSearchError(null);
      setPhase("embedding");

      es.addEventListener("embedding", () => setPhase("embedding"));
      es.addEventListener("vector_search", () => setPhase("vector_search"));
      es.addEventListener("graph_expand", () => setPhase("graph_expand"));
      es.addEventListener("node_found", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { id: string };
        setHighlighted((prev) => new Set(prev).add(payload.id));
      });
      es.addEventListener("results", (event) => {
        const results = JSON.parse((event as MessageEvent).data) as Array<{
          initiative: { id: string; title: string; teamId: string };
        }>;
        setMatches(
          results.map((r) => ({
            id: r.initiative.id,
            title: r.initiative.title,
            teamId: r.initiative.teamId,
          })),
        );
        setHighlighted((prev) => {
          const next = new Set(prev);
          for (const r of results) next.add(r.initiative.id);
          return next;
        });
      });
      es.addEventListener("done", () => {
        setPhase("done");
        es.close();
      });
      es.onerror = (event) => {
        // EventSource auto-reconnects on error, which would re-run the search
        // in a loop — close it and surface the failure instead. The api
        // sends its own "error" event with a message (e.g. AI not set up).
        const data = (event as MessageEvent).data;
        try {
          setSearchError(data ? (JSON.parse(data) as { message: string }).message : null);
        } catch {
          setSearchError(null);
        }
        es.close();
        setPhase((p) => (p === "done" ? p : "error"));
      };
    },
    [clearSearch],
  );
  useEffect(() => () => eventSourceRef.current?.close(), []);

  // Once results land, frame the teams they're in (one team opens).
  const framedSearch = useRef<unknown>(null);
  useEffect(() => {
    if (phase !== "done" || matches.length === 0 || framedSearch.current === matches) return;
    framedSearch.current = matches;
    const targets = [...new Set(matches.map((m) => m.teamId))].flatMap(
      (id) => circles.get(id) ?? [],
    );
    if (targets.length) cameraTo(fitCircles(targets, size, 80, TEAM_MAX_ZOOM, clearTop()));
  }, [phase, matches, circles, size, cameraTo]);

  // --------------------------------------------------------- focus / dim
  const [hover, setHover] = useState<Hover>(null);
  // An open team's circle is a backdrop: hovering it focuses nothing.
  const hoveredNode = hover?.kind === "node" ? nodeById.get(hover.id) : undefined;
  const hoverNodeId =
    hoveredNode && !(hoveredNode.kind === "team" && hoveredNode.open) ? hoveredNode.id : null;
  const selectedKey =
    selectedId && nodeById.has(initiativeKey(selectedId)) ? initiativeKey(selectedId) : null;
  const focusKey = hoverNodeId ?? selectedKey;
  const hasResults = highlighted.size > 0;
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of scene.links) {
      if (!map.has(l.source)) map.set(l.source, new Set());
      if (!map.has(l.target)) map.set(l.target, new Set());
      map.get(l.source)!.add(l.target);
      map.get(l.target)!.add(l.source);
    }
    return map;
  }, [scene]);

  // Teams with a match: from the results, and from matches already drawn.
  const hitTeams = useMemo(() => {
    const ids = new Set(matches.map((m) => m.teamId));
    for (const id of highlighted) {
      const node = nodeById.get(initiativeKey(id));
      if (node?.kind === "initiative") ids.add(node.teamId);
    }
    return ids;
  }, [matches, highlighted, nodeById]);

  const isDimmed = useCallback(
    (node: SceneNode) => {
      if (hasResults) {
        return node.kind === "team"
          ? !hitTeams.has(node.teamId)
          : !highlighted.has(node.initiativeId);
      }
      if (!focusKey) return false;
      // An open team's circle is a backdrop, not something to fade.
      if (node.kind === "team" && node.open) return false;
      return node.id !== focusKey && !neighbours.get(focusKey)?.has(node.id);
    },
    [hasResults, hitTeams, highlighted, focusKey, neighbours],
  );

  // ---------------------------------------------------------------- paint
  const paintNode = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, k: number) => {
      const node = raw as SceneNode;
      if (!palette) return;
      const dimmed = isDimmed(node);
      ctx.save();
      if (node.kind === "team") {
        const hue = hexFor(node.teamId);
        const hovered = hoverNodeId === node.id;
        const hit = hasResults && hitTeams.has(node.teamId);
        ctx.globalAlpha = dimmed ? 0.3 : 1;
        if (node.open) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r, 0, 2 * Math.PI);
          ctx.fillStyle = `${hue}10`;
          ctx.fill();
          ctx.strokeStyle = `${hue}70`;
          ctx.lineWidth = 1.2 / k;
          ctx.setLineDash([5 / k, 4 / k]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          if (hit) {
            ctx.shadowColor = palette.accent;
            ctx.shadowBlur = 16;
          }
          // Opaque, so lines into a closed team stop at its edge.
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r, 0, 2 * Math.PI);
          ctx.fillStyle = palette.background;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = `${hue}26`;
          ctx.fill();
          ctx.strokeStyle = hovered ? hue : `${hue}99`;
          ctx.lineWidth = (hovered ? 2.2 : 1.4) / k;
          if (loadingTeams.has(node.teamId)) ctx.setLineDash([4 / k, 4 / k]);
          ctx.stroke();
          ctx.setLineDash([]);
          // A ring split by status: what the team's work looks like at a glance.
          const ring = Math.min(4 / k, node.r * 0.14);
          const total = node.team.total || 1;
          let start = -Math.PI / 2;
          ctx.lineWidth = ring;
          for (const status of INITIATIVE_STATUSES) {
            const n = node.team.byStatus[status] ?? 0;
            if (!n) continue;
            const sweep = (n / total) * 2 * Math.PI;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.r - ring / 2 - 1 / k, start, start + sweep);
            ctx.strokeStyle = STATUS_META[status].hex;
            ctx.stroke();
            start += sweep;
          }
          if (hit) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.r + 4 / k, 0, 2 * Math.PI);
            ctx.strokeStyle = palette.accent;
            ctx.lineWidth = 2 / k;
            ctx.stroke();
          }
        }
      } else {
        const hit = highlighted.has(node.initiativeId);
        const selected = node.initiativeId === selectedId;
        const color = STATUS_META[node.status]?.hex ?? "#a1a1b5";
        ctx.globalAlpha = dimmed ? 0.18 : 1;
        if (hit || selected) {
          ctx.shadowColor = hit ? palette.accent : color;
          ctx.shadowBlur = 18;
        }
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        // Inner core gives nodes some depth.
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r * 0.45, 0, 2 * Math.PI);
        ctx.fillStyle = palette.core;
        ctx.fill();
        if (hit || selected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + 3 / k + 1.5, 0, 2 * Math.PI);
          ctx.strokeStyle = hit ? palette.accent : palette.ring;
          ctx.lineWidth = 1.5 / k;
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    [palette, isDimmed, hoverNodeId, hasResults, hitTeams, highlighted, selectedId, loadingTeams],
  );

  // Labels go on last, in screen space, so they're crisp at any zoom and
  // never overlap: the most important ones win the space.
  const paintLabels = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!palette) return;
      const m = ctx.getTransform();
      const dpr = window.devicePixelRatio || 1;
      const k = m.a / dpr;
      const tx = m.e / dpr;
      const ty = m.f / dpr;
      const width = ctx.canvas.width / dpr;
      const height = ctx.canvas.height / dpr;
      const labelsFit = k >= LABEL_ZOOM;

      type Label = LabelBox & {
        lines: { text: string; font: string; color: string }[];
        cx: number;
        top: number;
      };
      const labels: Label[] = [];
      const push = (
        cx: number,
        top: number,
        lines: { text: string; font: string; color: string; size: number }[],
        priority: number,
      ) => {
        const fitted = lines.filter((l) => l.text);
        if (!fitted.length) return;
        let w = 0;
        for (const l of fitted) {
          ctx.font = l.font;
          w = Math.max(w, measure(ctx, l.text));
        }
        const h = fitted.reduce((sum, l) => sum + l.size + 2, 0);
        labels.push({
          x: cx - w / 2 - 3,
          y: top - 1,
          w: w + 6,
          h: h + 2,
          priority,
          lines: fitted,
          cx,
          top,
        });
      };
      const text = (font: string, value: string, max: number) => {
        ctx.font = font;
        return fitText(ctx, value, max) ?? "";
      };
      const bold = "600 12px ui-sans-serif, system-ui, sans-serif";
      const small = "500 11px ui-sans-serif, system-ui, sans-serif";

      for (const node of scene.nodes) {
        const sx = node.x * k + tx;
        const sy = node.y * k + ty;
        const sr = node.r * k;
        if (sx + sr < -40 || sx - sr > width + 40 || sy + sr < -40 || sy - sr > height + 40)
          continue;
        if (isDimmed(node)) continue;
        if (node.kind === "team") {
          const hue = hexFor(node.teamId);
          const count = plural(node.team.total, "initiative");
          if (node.open) {
            const capped =
              node.shown < node.team.total ? ` · showing ${node.shown.toLocaleString()}` : "";
            push(
              sx,
              sy - sr - 20,
              [
                {
                  text: text(bold, `${node.team.name} · ${count}${capped}`, 360),
                  font: bold,
                  color: hue,
                  size: 12,
                },
              ],
              10_000 + sr,
            );
          } else if (sr >= 34) {
            push(
              sx,
              sy - (sr >= 48 ? 14 : 7),
              [
                {
                  text: text(bold, node.team.name, sr * 1.7),
                  font: bold,
                  color: palette.label,
                  size: 12,
                },
                ...(sr >= 48
                  ? [
                      {
                        text: text(
                          small,
                          loadingTeams.has(node.teamId) ? "Loading…" : count,
                          sr * 1.6,
                        ),
                        font: small,
                        color: palette.labelMuted,
                        size: 11,
                      },
                    ]
                  : []),
              ],
              5_000 + sr,
            );
          } else if (sr >= 3) {
            push(
              sx,
              sy + sr + 3,
              [
                {
                  text: text(bold, node.team.name, 160),
                  font: bold,
                  color: palette.labelMuted,
                  size: 12,
                },
              ],
              1_000 + sr,
            );
          }
        } else {
          const selected = node.initiativeId === selectedId;
          const hovered = hoverNodeId === node.id;
          const hit = highlighted.has(node.initiativeId);
          const near = !!focusKey && neighbours.get(focusKey)?.has(node.id);
          if (!labelsFit && !selected && !hovered && !hit && !near) continue;
          const strong = selected || hit || hovered;
          const font = strong ? "600 11px ui-sans-serif, system-ui, sans-serif" : small;
          // What the reader is looking at gets its full name; the rest what fits.
          const max = strong || near ? 200 : Math.min(200, Math.max(90, NODE_SPACING * k * 2));
          push(
            sx,
            sy + sr + 3,
            [
              {
                text: text(font, node.name, max),
                font,
                color: strong ? palette.label : palette.labelMuted,
                size: 11,
              },
            ],
            (selected ? 9_000 : hovered ? 8_500 : hit ? 7_000 : near ? 6_000 : 100) +
              node.degree * 10,
          );
        }
      }

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const i of placeLabels(labels)) {
        const label = labels[i]!;
        ctx.fillStyle = palette.labelBg;
        ctx.fillRect(label.x, label.y, label.w, label.h);
        let y = label.top;
        for (const line of label.lines) {
          ctx.font = line.font;
          ctx.fillStyle = line.color;
          ctx.fillText(line.text, label.cx, y);
          y += (line.font.includes("12px") ? 12 : 11) + 2;
        }
      }
      ctx.restore();
    },
    [
      palette,
      scene,
      isDimmed,
      loadingTeams,
      selectedId,
      hoverNodeId,
      highlighted,
      focusKey,
      neighbours,
    ],
  );

  const paintPointerArea = useCallback(
    (raw: object, color: string, ctx: CanvasRenderingContext2D) => {
      const node = raw as SceneNode;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.kind === "team" ? node.r : node.r + 3, 0, 2 * Math.PI);
      ctx.fill();
    },
    [],
  );

  const linkTouchesFocus = useCallback(
    (l: SceneLink) => {
      const s = typeof l.source === "string" ? l.source : (l.source as SceneNode).id;
      const t = typeof l.target === "string" ? l.target : (l.target as SceneNode).id;
      return { s, t, focused: !!focusKey && (s === focusKey || t === focusKey) };
    },
    [focusKey],
  );
  const linkBase = (l: SceneLink) => Math.min(1 + Math.log2(l.count) * 1.2, 7);
  const linkColor = useCallback(
    (raw: object) => {
      const link = raw as SceneLink;
      const { s, t, focused } = linkTouchesFocus(link);
      const base = EDGE_LABEL[link.type]?.hex ?? "#5a5a6e";
      const a = nodeById.get(s);
      const b = nodeById.get(t);
      const dim = (a && isDimmed(a)) || (b && isDimmed(b));
      const hovered = hover?.kind === "link" && hover.id === link.id;
      // Thousands of lines would drown the teams: draw them fainter.
      const quiet = scene.links.length > 400;
      return `${base}${hovered || focused ? "ee" : dim ? "1c" : quiet ? "38" : "88"}`;
    },
    [linkTouchesFocus, nodeById, isDimmed, hover, scene],
  );

  const zoomBy = (factor: number) => {
    const g = graphRef.current;
    if (g) g.zoom(g.zoom() * factor, 250);
  };

  // ------------------------------------------------------------- tooltip
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltip = useMemo(() => {
    if (!hover) return null;
    if (hover.kind === "link") {
      const link = scene.links.find((l) => l.id === hover.id);
      return link ? { title: describeLink(link, nodeById) } : null;
    }
    const node = nodeById.get(hover.id);
    if (!node) return null;
    if (node.kind === "initiative") {
      const team = nodeById.get(teamKey(node.teamId));
      return {
        title: node.name,
        detail: `${STATUS_META[node.status].label} · ${nodeName(team)}`,
      };
    }
    if (node.open) return null;
    const related = node.team.connected;
    return {
      title: node.team.name,
      detail: [
        node.team.orgUnit,
        plural(node.team.total, "initiative"),
        related ? `${related.toLocaleString()} related to other teams` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      hint: "Click or zoom in to see its work",
    };
  }, [hover, scene, nodeById]);
  const movePointer = (e: React.PointerEvent) => {
    const el = tooltipRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!el || !box) return;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    // Keep it inside the view: flip left near the right edge.
    const flip = x > box.width - 280;
    el.style.transform = `translate(${flip ? x - 12 : x + 14}px, ${y + 14}px) translateX(${flip ? "-100%" : "0"})`;
  };

  // ---------------------------------------------------------------- render
  const aiOff = llmStatus?.configured === false;
  const drawnInitiatives = scene.nodes.length - teams.length;
  const statusLine = teams.length
    ? `${plural(teams.length, "team")} on the map, ${openTeams.size} open, ${plural(drawnInitiatives, "initiative")} shown.`
    : "";

  if (error) {
    return <ErrorNote className="m-6">Couldn&apos;t load the graph: {error.message}</ErrorNote>;
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={movePointer}
      className="bg-grid relative h-full overflow-hidden"
    >
      <div
        ref={toolbarRef}
        className="absolute left-4 right-4 top-4 z-10 flex flex-wrap items-start gap-2"
      >
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface/85 p-2 shadow-pop backdrop-blur-md">
          <CentrePicker
            onPick={(i) => {
              clicked.current = i.id;
              lastSelected.current = i.id;
              onSelect(i.id);
              focusInitiative(i.id, i.teamId);
            }}
          />
          <Select
            filter
            icon={<Users className="h-3.5 w-3.5" />}
            aria-label="Go to a team"
            value={circles.has(url.team) ? url.team : ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              navigate({ team: id, i: null }, { replace: true });
              focusTeam(id);
            }}
            className="w-72"
          >
            <option value="">Or go to a team…</option>
            {(teamList ?? [])
              .filter((t) => circles.has(t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface/85 p-2 shadow-pop backdrop-blur-md">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query);
            }}
          >
            <Input
              icon={<Search className="h-4 w-4" />}
              placeholder={
                aiOff ? "Semantic search needs an AI model" : "Semantic search the graph…"
              }
              title={aiOff ? "An admin can connect one in Admin → AI & models." : undefined}
              disabled={aiOff}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-72 border-transparent bg-background/60"
              trailing={
                query || phase !== "idle" ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery("");
                      clearSearch();
                    }}
                    className="text-subtle hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : undefined
              }
            />
          </form>
          {phase !== "idle" && (
            <div className="flex items-center justify-between gap-3 px-1 pb-0.5">
              {phase === "error" ? (
                <p className="text-[11px] text-status-blocked">
                  {searchError ?? "Search failed — try again in a moment."}
                </p>
              ) : (
                <PhaseStepper phase={phase} />
              )}
              {phase !== "error" && (
                <span className="whitespace-nowrap text-[11px] text-muted">
                  {highlighted.size} match{highlighted.size === 1 ? "" : "es"}
                </span>
              )}
            </div>
          )}
          {phase === "done" && matches.length > 0 && (
            <ul aria-label="Matches" className="max-h-40 w-72 overflow-y-auto px-1">
              {matches.slice(0, 8).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(m.id)}
                    title="Go to it on the map"
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted hover:bg-elevated hover:text-foreground"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: hexFor(m.teamId) }}
                    />
                    <span className="truncate">{m.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      ) : teams.length === 0 ? (
        <EmptyState
          className="h-full"
          icon={<Waypoints className="h-5 w-5" />}
          title="Nothing to map yet"
          description="Once teams add initiatives, each team shows up here as a circle, joined to the teams whose work is related."
        />
      ) : (
        size.width > 0 && (
          <div
            className={cn(
              "h-full transition-opacity duration-300",
              // The map is dragged around: an open hand, a closed one while
              // panning. force-graph's own .clickable (a pointer over teams
              // and initiatives) is more specific, so it still wins.
              "[&_canvas:active]:cursor-grabbing [&_canvas]:cursor-grab",
              fitted ? "opacity-100" : "opacity-0",
            )}
          >
            <ForceGraphCanvas
              graphRef={graphRef}
              onReady={markReady}
              width={size.width}
              height={size.height}
              graphData={graphData}
              nodeId="id"
              nodeRelSize={1}
              nodeVal={(n) => (n as SceneNode).r ** 2}
              nodeLabel={() => ""}
              linkLabel={() => ""}
              backgroundColor="rgba(0,0,0,0)"
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={paintPointerArea}
              onRenderFramePost={paintLabels}
              linkColor={linkColor}
              linkWidth={(l) => {
                const link = l as SceneLink;
                return linkBase(link) + (linkTouchesFocus(link).focused ? 1 : 0);
              }}
              linkCurvature={(l) => (l as SceneLink).curvature}
              // "Related" has no direction, so no arrowhead. Arrowheads are
              // in world units: scale them so they read the same at any zoom.
              linkDirectionalArrowLength={(l) =>
                (l as SceneLink).type === "related"
                  ? 0
                  : (5 + Math.min(linkBase(l as SceneLink), 4)) / zoomK
              }
              linkDirectionalArrowRelPos={1}
              linkDirectionalParticles={(l) => (linkTouchesFocus(l as SceneLink).focused ? 2 : 0)}
              linkDirectionalParticleWidth={2.5 / Math.sqrt(zoomK)}
              linkDirectionalParticleColor={() => palette?.accent ?? "#818cf8"}
              enableNodeDrag={false}
              warmupTicks={0}
              cooldownTicks={0}
              minZoom={0.02}
              maxZoom={12}
              onZoom={onZoom}
              onZoomEnd={onZoom}
              onNodeHover={(node) =>
                setHover(node ? { kind: "node", id: String((node as SceneNode).id) } : null)
              }
              onLinkHover={(link) =>
                setHover((h) =>
                  link
                    ? { kind: "link", id: (link as SceneLink).id }
                    : h?.kind === "link"
                      ? null
                      : h,
                )
              }
              onNodeClick={(raw) => {
                const node = raw as SceneNode;
                if (node.kind === "team") {
                  focusTeam(node.teamId);
                  return;
                }
                clicked.current = node.initiativeId;
                onSelect(node.initiativeId);
              }}
            />
          </div>
        )
      )}

      <div
        ref={tooltipRef}
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-20 max-w-64 rounded-lg border border-border bg-surface/95 px-2.5 py-1.5 text-xs shadow-pop backdrop-blur-md",
          !tooltip && "hidden",
        )}
      >
        {tooltip && (
          <>
            <p className="font-medium text-foreground">{tooltip.title}</p>
            {"detail" in tooltip && tooltip.detail && (
              <p className="text-muted">{tooltip.detail}</p>
            )}
            {"hint" in tooltip && tooltip.hint && (
              <p className="mt-0.5 text-subtle">{tooltip.hint}</p>
            )}
          </>
        )}
      </div>

      <p role="status" className="sr-only">
        {statusLine}
      </p>
      {fitted && openTeams.size === 0 && teams.length > 0 && (
        <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-surface/85 px-3 py-1 text-xs text-muted shadow-pop backdrop-blur-md max-sm:hidden">
          Click a team, or zoom in, to see its initiatives
        </p>
      )}

      <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-border bg-surface/85 p-3 text-[11px] shadow-pop backdrop-blur-md">
        <p className="mb-2 font-medium uppercase tracking-wider text-subtle">Status</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {(
            Object.entries(STATUS_META) as [
              InitiativeStatus,
              (typeof STATUS_META)[InitiativeStatus],
            ][]
          ).map(([id, meta]) => (
            <span key={id} className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: meta.hex }} />
              {meta.label}
            </span>
          ))}
        </div>
        <p className="mb-2 mt-3 font-medium uppercase tracking-wider text-subtle">Relationships</p>
        <div className="flex flex-col gap-1">
          {Object.entries(EDGE_LABEL).map(([id, meta]) => (
            <span key={id} className="flex items-center gap-1.5 text-muted">
              <span className="h-0.5 w-4 rounded-full" style={{ background: meta.hex }} />
              {meta.outgoing}
            </span>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-muted">
          <span className="h-3 w-3 rounded-full border border-border-strong" />A team, sized by its
          work
        </p>
      </div>

      <div className="absolute bottom-4 right-4 z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-surface/85 shadow-pop backdrop-blur-md">
        {(
          [
            { label: "Zoom in", icon: Plus, onClick: () => zoomBy(1.4) },
            { label: "Zoom out", icon: Minus, onClick: () => zoomBy(1 / 1.4) },
            { label: "Fit to screen", icon: Maximize2, onClick: () => fitAll() },
          ] as const
        ).map(({ label, icon: Icon, onClick }) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className="focus-ring flex h-8 w-8 items-center justify-center text-muted transition-colors hover:bg-elevated hover:text-foreground not-last:border-b not-last:border-border"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
