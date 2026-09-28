// The graph view's map of the organisation, as pure functions: where teams
// and initiatives sit, which teams are open at the current zoom, which lines
// join what, and where the camera goes. The view only draws the result.
//
// The layout is computed once, not simulated live: each team's circle is
// sized up front for everything it can show, so opening a team fills its
// circle without moving anything else, and the picture never drifts.

import type {
  EdgeType,
  GraphTeam,
  GraphTeamDetail,
  GraphTeamLink,
  InitiativeStatus,
} from "@scry/shared";
import { INITIATIVE_STATUSES } from "@scry/shared";

/** World units between neighbouring initiatives inside a team. */
export const NODE_SPACING = 26;
/** Phyllotaxis step giving roughly NODE_SPACING between neighbours. */
const SLOT = NODE_SPACING / 1.8;
const TEAM_PADDING = 22;
const TEAM_MIN_RADIUS = 48;
/** Space between team circles. */
const TEAM_GAP = 40;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Teams open once their initiatives would sit this far apart on screen, and
 * close again below the second (so nothing flickers at the threshold). It's
 * the same for every team, so all teams in view open and close together.
 */
export const OPEN_SPACING_PX = 24;
export const CLOSE_SPACING_PX = 18;
/** The most initiatives drawn at once; the biggest teams on screen open first. */
export const NODE_BUDGET = 1500;

export interface Point {
  x: number;
  y: number;
}
export interface Circle extends Point {
  r: number;
}
/** d3-zoom's transform: screen = world × k + (x, y). */
export interface Transform {
  k: number;
  x: number;
  y: number;
}
export interface Viewport {
  width: number;
  height: number;
}

export function teamRadius(shown: number): number {
  return Math.max(TEAM_MIN_RADIUS, SLOT * Math.sqrt(Math.max(shown, 1)) + TEAM_PADDING);
}

/**
 * A team's circle: room for what it can show, and a little bigger for work
 * beyond that, so a team of 3,000 doesn't look like one of 200.
 */
export function teamCircleRadius(total: number, limit: number): number {
  const shown = Math.min(total, limit);
  return teamRadius(shown) + (total > shown ? 16 * Math.log2(total / shown) : 0);
}

export function initiativeRadius(degree: number): number {
  return 4 + Math.min(degree, 6) * 0.9;
}

// ------------------------------------------------------------ team layout

/**
 * Pushes overlapping circles apart, in place, and returns the worst overlap
 * it found. Arrays, not maps: this runs hundreds of times.
 */
function collide(xs: Float64Array, ys: Float64Array, rs: Float64Array): number {
  const n = xs.length;
  // A grid keeps this near linear: only neighbouring cells can overlap when
  // a cell is as wide as the biggest pair needs.
  let maxR = 0;
  for (let i = 0; i < n; i++) maxR = Math.max(maxR, rs[i]!);
  const cell = 2 * maxR + TEAM_GAP;
  const grid = new Map<number, number[]>();
  const keyOf = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const key = keyOf(Math.floor(xs[i]! / cell), Math.floor(ys[i]! / cell));
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  }
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(xs[i]! / cell);
    const cy = Math.floor(ys[i]! / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(keyOf(cx + dx, cy + dy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const min = rs[i]! + rs[j]! + TEAM_GAP;
          let ddx = xs[j]! - xs[i]!;
          let ddy = ys[j]! - ys[i]!;
          if (Math.abs(ddx) >= min || Math.abs(ddy) >= min) continue;
          let d = Math.hypot(ddx, ddy);
          if (d >= min) continue;
          worst = Math.max(worst, min - d);
          if (d < 1e-6) {
            // Same spot: part them along a direction fixed by their order.
            ddx = Math.cos(i + j);
            ddy = Math.sin(i + j);
            d = 1;
          }
          const push = (min - d) / 2 / d;
          xs[i]! -= ddx * push;
          ys[i]! -= ddy * push;
          xs[j]! += ddx * push;
          ys[j]! += ddy * push;
        }
      }
    }
  }
  return worst;
}

/**
 * Where each team's circle goes. Teams of one org unit start together and
 * stay near each other; related teams pull closer; nothing overlaps.
 * Deterministic for the same input. `previous` positions (from before the
 * data changed) are kept as the starting point so the map barely moves.
 */
export function layoutTeams(
  teams: { id: string; orgUnit: string | null; r: number }[],
  links: { a: string; b: string; weight: number }[],
  previous?: Map<string, Point>,
): Map<string, Circle> {
  const sorted = [...teams].sort(
    (a, b) => (a.orgUnit ?? "￿").localeCompare(b.orgUnit ?? "￿") || a.id.localeCompare(b.id),
  );
  const n = sorted.length;
  if (n === 0) return new Map();
  const index = new Map(sorted.map((t, i) => [t.id, i]));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const rs = Float64Array.from(sorted.map((t) => t.r));
  const units = [...new Set(sorted.map((t) => t.orgUnit ?? ""))];
  const unitOf = Int32Array.from(sorted.map((t) => units.indexOf(t.orgUnit ?? "")));

  // Start: each org unit gets a spot on a spiral big enough for its teams,
  // and its teams spiral around that spot.
  const members = units.map((_, u) => sorted.flatMap((t, i) => (unitOf[i] === u ? [i] : [])));
  const spacing = members.map(
    (list) => list.reduce((sum, i) => sum + 2 * rs[i]! + TEAM_GAP, 0) / list.length,
  );
  const unitSpan = Math.max(
    ...members.map((list, u) => spacing[u]! * Math.sqrt(list.length) * 1.2),
  );
  members.forEach((list, u) => {
    const spread = units.length === 1 ? 0 : Math.sqrt(u + 0.5) * unitSpan;
    const ax = Math.cos(u * GOLDEN_ANGLE) * spread;
    const ay = Math.sin(u * GOLDEN_ANGLE) * spread;
    list.forEach((i, k) => {
      const kept = previous?.get(sorted[i]!.id);
      const r = list.length === 1 ? 0 : Math.sqrt(k + 0.5) * spacing[u]! * 0.6;
      xs[i] = kept ? kept.x : ax + Math.cos(k * GOLDEN_ANGLE) * r;
      ys[i] = kept ? kept.y : ay + Math.sin(k * GOLDEN_ANGLE) * r;
    });
  });

  const pairs = links.flatMap((l) => {
    const a = index.get(l.a);
    const b = index.get(l.b);
    return a === undefined || b === undefined || a === b
      ? []
      : [{ a, b, w: Math.min(l.weight, 4) }];
  });
  const warm = !!previous && sorted.every((t) => previous.has(t.id));
  // Starting from the last picture only needs to settle what changed.
  const iterations = warm ? 60 : 240;
  const heat = warm ? 0.2 : 1;
  const cx = new Float64Array(units.length);
  const cy = new Float64Array(units.length);
  const count = new Float64Array(units.length);
  for (let step = 0; step < iterations; step++) {
    const alpha = heat * (1 - step / iterations);
    for (const { a, b, w } of pairs) {
      const dx = xs[b]! - xs[a]!;
      const dy = ys[b]! - ys[a]!;
      const d = Math.hypot(dx, dy) || 1;
      const rest = rs[a]! + rs[b]! + TEAM_GAP * 2;
      const pull = ((d - rest) / d) * 0.04 * alpha * w;
      xs[a]! += dx * pull;
      ys[a]! += dy * pull;
      xs[b]! -= dx * pull;
      ys[b]! -= dy * pull;
    }
    // Keep each org unit together, and everything loosely around the middle.
    cx.fill(0);
    cy.fill(0);
    count.fill(0);
    for (let i = 0; i < n; i++) {
      cx[unitOf[i]!]! += xs[i]!;
      cy[unitOf[i]!]! += ys[i]!;
      count[unitOf[i]!]! += 1;
    }
    for (let i = 0; i < n; i++) {
      const u = unitOf[i]!;
      xs[i]! += (cx[u]! / count[u]! - xs[i]!) * 0.03 * alpha - xs[i]! * 0.01 * alpha;
      ys[i]! += (cy[u]! / count[u]! - ys[i]!) * 0.03 * alpha - ys[i]! * 0.01 * alpha;
    }
    collide(xs, ys, rs);
  }
  // A dense map needs many passes before every pair is apart; stop once it is.
  for (let i = 0; i < 1000 && collide(xs, ys, rs) > 0.5; i++);

  return new Map(sorted.map((t, i) => [t.id, { x: xs[i]!, y: ys[i]!, r: rs[i]! }]));
}

// ------------------------------------------------- initiatives in a team

const STATUS_ORDER = new Map(INITIATIVE_STATUSES.map((s, i) => [s, i]));

function angleBetween(a: number, b: number) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/**
 * Where a team's initiatives sit inside its circle: on a sunflower spiral,
 * with work related to other teams on the rim facing those teams (so lines
 * stay short) and the rest inside, grouped by status.
 */
export function layoutTeamInitiatives(
  circle: Circle,
  nodes: { id: string; title: string; status: InitiativeStatus; degree: number }[],
  /** Direction (radians) towards the teams each initiative is related to. */
  facing: Map<string, number>,
): Map<string, Point> {
  const n = nodes.length;
  if (n === 0) return new Map();
  // Squeeze if the team has grown past what its circle was sized for.
  const step = Math.min(SLOT, (circle.r - TEAM_PADDING * 0.7) / Math.sqrt(n));
  const slots = Array.from({ length: n }, (_, i) => ({
    x: circle.x + Math.cos(i * GOLDEN_ANGLE) * step * Math.sqrt(i + 0.5),
    y: circle.y + Math.sin(i * GOLDEN_ANGLE) * step * Math.sqrt(i + 0.5),
    angle: (((i * GOLDEN_ANGLE) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
  }));
  const out = new Map<string, (typeof slots)[number]>();
  const free = new Set(slots.keys());
  const facingNodes = nodes
    .filter((node) => facing.has(node.id))
    .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  const rim = Math.min(n, Math.max(facingNodes.length, Math.ceil(n * 0.35)));
  for (const node of facingNodes) {
    const want = facing.get(node.id)!;
    let best = -1;
    for (let i = n - 1; i >= n - rim; i--) {
      if (!free.has(i)) continue;
      if (best < 0 || angleBetween(slots[i]!.angle, want) < angleBetween(slots[best]!.angle, want))
        best = i;
    }
    if (best < 0) best = Math.max(...free);
    free.delete(best);
    out.set(node.id, slots[best]!);
  }
  const rest = nodes
    .filter((node) => !facing.has(node.id))
    .sort(
      (a, b) =>
        STATUS_ORDER.get(a.status)! - STATUS_ORDER.get(b.status)! ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
  const inner = [...free].sort((a, b) => a - b);
  rest.forEach((node, i) => out.set(node.id, slots[inner[i]!]!));
  return new Map([...out].map(([id, p]) => [id, { x: p.x, y: p.y }]));
}

// ------------------------------------------------------------- the scene

export interface TeamNode {
  kind: "team";
  /** `t:<team id>` */
  id: string;
  teamId: string;
  team: GraphTeam;
  x: number;
  y: number;
  r: number;
  /** Showing its initiatives. */
  open: boolean;
  /** Initiatives drawn inside, when open (fewer than `team.total` when capped). */
  shown: number;
}

export interface InitiativeNode {
  kind: "initiative";
  /** `i:<initiative id>` */
  id: string;
  initiativeId: string;
  teamId: string;
  name: string;
  status: InitiativeStatus;
  degree: number;
  x: number;
  y: number;
  r: number;
}

export type SceneNode = TeamNode | InitiativeNode;

export interface SceneLink {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  /** Relationships this line stands for. */
  count: number;
  curvature: number;
}

export const teamKey = (teamId: string) => `t:${teamId}`;
export const initiativeKey = (id: string) => `i:${id}`;

/** An open team's initiatives, laid out. */
export interface OpenTeam {
  detail: GraphTeamDetail;
  positions: Map<string, Point>;
  degree: Map<string, number>;
}

/** Edges per initiative, and which way each initiative should face. */
export function prepareOpenTeam(detail: GraphTeamDetail, circles: Map<string, Circle>): OpenTeam {
  const circle = circles.get(detail.teamId)!;
  const shown = new Set(detail.nodes.map((n) => n.id));
  const degree = new Map<string, number>();
  const pull = new Map<string, Point>();
  for (const e of detail.edges) {
    for (const [mine, other] of [
      [e.fromInitiativeId, e.toTeamId],
      [e.toInitiativeId, e.fromTeamId],
    ] as const) {
      if (!shown.has(mine)) continue;
      degree.set(mine, (degree.get(mine) ?? 0) + 1);
      const towards = circles.get(other);
      if (!towards || other === detail.teamId) continue;
      const d = Math.hypot(towards.x - circle.x, towards.y - circle.y) || 1;
      const p = pull.get(mine) ?? { x: 0, y: 0 };
      pull.set(mine, {
        x: p.x + (towards.x - circle.x) / d,
        y: p.y + (towards.y - circle.y) / d,
      });
    }
  }
  const facing = new Map<string, number>();
  for (const [id, p] of pull) {
    if (Math.hypot(p.x, p.y) > 1e-6) facing.set(id, Math.atan2(p.y, p.x));
  }
  const positions = layoutTeamInitiatives(
    circle,
    detail.nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })),
    facing,
  );
  return { detail, positions, degree };
}

/**
 * What to draw: every team as a circle, open teams' initiatives inside
 * theirs, and one line per pair of things drawn and relationship type. A
 * relationship whose end isn't drawn (its team is closed, or capped) is
 * drawn to that end's team circle instead, and counted there.
 */
export function buildScene(
  teams: GraphTeam[],
  teamLinks: GraphTeamLink[],
  circles: Map<string, Circle>,
  open: Map<string, OpenTeam>,
): { nodes: SceneNode[]; links: SceneLink[] } {
  const teamNodes: TeamNode[] = [];
  const initiativeNodes: InitiativeNode[] = [];
  for (const team of teams) {
    const c = circles.get(team.id);
    if (!c) continue;
    const o = open.get(team.id);
    teamNodes.push({
      kind: "team",
      id: teamKey(team.id),
      teamId: team.id,
      team,
      x: c.x,
      y: c.y,
      r: c.r,
      open: !!o,
      shown: o?.detail.nodes.length ?? 0,
    });
    if (!o) continue;
    for (const n of o.detail.nodes) {
      const p = o.positions.get(n.id);
      if (!p) continue;
      const degree = o.degree.get(n.id) ?? 0;
      initiativeNodes.push({
        kind: "initiative",
        id: initiativeKey(n.id),
        initiativeId: n.id,
        teamId: n.teamId,
        name: n.title,
        status: n.status,
        degree,
        x: p.x,
        y: p.y,
        r: initiativeRadius(degree),
      });
    }
  }
  const drawn = new Set(initiativeNodes.map((n) => n.initiativeId));
  const endOf = (initiativeId: string, teamId: string) =>
    drawn.has(initiativeId) ? initiativeKey(initiativeId) : teamKey(teamId);

  const merged = new Map<string, Omit<SceneLink, "curvature">>();
  const add = (source: string, target: string, type: EdgeType, count: number) => {
    if (source === target) return;
    // "related" has no direction: one line per pair, whichever way it's stored.
    if (type === "related" && target < source) [source, target] = [target, source];
    const id = `${source}>${target}:${type}`;
    const link = merged.get(id) ?? { id, source, target, type, count: 0 };
    link.count += count;
    merged.set(id, link);
  };
  const seen = new Set<string>();
  for (const o of open.values()) {
    for (const e of o.detail.edges) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      add(endOf(e.fromInitiativeId, e.fromTeamId), endOf(e.toInitiativeId, e.toTeamId), e.type, 1);
    }
  }
  // Pairs of closed teams use the counts from the overview; an open team's
  // relationships all came with its detail above.
  for (const l of teamLinks) {
    if (open.has(l.fromTeamId) || open.has(l.toTeamId)) continue;
    if (!circles.has(l.fromTeamId) || !circles.has(l.toTeamId)) continue;
    add(teamKey(l.fromTeamId), teamKey(l.toTeamId), l.type, l.count);
  }

  // Several lines between the same two things bend apart; opposite
  // directions get opposite signs, since force-graph bends relative to
  // each line's own direction.
  const byPair = new Map<string, Omit<SceneLink, "curvature">[]>();
  for (const l of merged.values()) {
    const key = l.source < l.target ? `${l.source}|${l.target}` : `${l.target}|${l.source}`;
    const list = byPair.get(key);
    if (list) list.push(l);
    else byPair.set(key, [l]);
  }
  const links: SceneLink[] = [];
  for (const list of byPair.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    list.forEach((l, i) => {
      const offset = list.length === 1 ? 0 : (i - (list.length - 1) / 2) * 0.3;
      links.push({ ...l, curvature: l.source < l.target ? offset : -offset });
    });
  }
  return { nodes: [...teamNodes, ...initiativeNodes], links };
}

// --------------------------------------------------- which teams are open

export function toScreen(p: Point, t: Transform): Point {
  return { x: p.x * t.k + t.x, y: p.y * t.k + t.y };
}

/**
 * Teams to open at this zoom: every team in view once initiatives would be
 * far enough apart to read (or once it fills much of the view), the biggest
 * on screen first, until the node budget is spent (then zooming in further
 * opens the rest).
 */
export function pickOpenTeams(
  teams: { id: string; circle: Circle; shown: number }[],
  t: Transform,
  view: Viewport,
  currentlyOpen: ReadonlySet<string>,
  budget = NODE_BUDGET,
): Set<string> {
  const candidates: { id: string; size: number; cost: number }[] = [];
  const margin = Math.min(view.width, view.height) * 0.15;
  const spacing = NODE_SPACING * t.k;
  const short = Math.min(view.width, view.height);
  for (const { id, circle, shown } of teams) {
    const size = circle.r * t.k;
    const open = currentlyOpen.has(id);
    // Also open a team that fills much of the view, even if packed tight.
    const readable = spacing >= (open ? CLOSE_SPACING_PX : OPEN_SPACING_PX);
    const dominant = size >= short * (open ? 0.18 : 0.25);
    if (!(readable || dominant) || shown === 0) continue;
    const c = toScreen(circle, t);
    const visible =
      c.x + size > -margin &&
      c.x - size < view.width + margin &&
      c.y + size > -margin &&
      c.y - size < view.height + margin;
    if (visible) candidates.push({ id, size, cost: shown });
  }
  candidates.sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));
  const out = new Set<string>();
  let spent = 0;
  for (const c of candidates) {
    if (spent + c.cost > budget && out.size > 0) continue;
    out.add(c.id);
    spent += c.cost;
  }
  return out;
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

// ----------------------------------------------------------------- camera

/**
 * The centre and zoom that fit the circles (plus `padding` screen px, and
 * room above for a team's name), no closer than `maxK`. `top` px are kept
 * clear for the toolbar floating over the canvas.
 */
export function fitCircles(
  circles: Circle[],
  view: Viewport,
  padding: number,
  maxK: number,
  top = 0,
): Transform & { cx: number; cy: number } {
  const minX = Math.min(...circles.map((c) => c.x - c.r));
  const maxX = Math.max(...circles.map((c) => c.x + c.r));
  const minY = Math.min(...circles.map((c) => c.y - c.r));
  const maxY = Math.max(...circles.map((c) => c.y + c.r));
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  // Team names sit above their circle at a fixed on-screen size.
  const labelRoom = 24;
  const k = Math.max(
    0.01,
    Math.min(
      maxK,
      (view.width - padding * 2) / w,
      (view.height - top - padding * 2 - labelRoom) / h,
    ),
  );
  // `cx, cy` is the world point at the middle of the view (what centerAt takes).
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 - (labelRoom + top) / 2 / k;
  return { k, cx, cy, x: view.width / 2 - cx * k, y: view.height / 2 - cy * k };
}

// ----------------------------------------------------------------- labels

export interface LabelBox {
  /** Screen px, top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
}

/**
 * Which labels to draw so none overlap: the most important first, each
 * kept only if it doesn't touch one already kept. Returns their indices.
 */
export function placeLabels(boxes: LabelBox[], gap = 2): number[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b]!.priority - boxes[a]!.priority);
  const cell = 80;
  const grid = new Map<string, number[]>();
  const kept: number[] = [];
  const cells = (b: LabelBox) => {
    const out: string[] = [];
    for (let x = Math.floor(b.x / cell); x <= Math.floor((b.x + b.w) / cell); x++) {
      for (let y = Math.floor(b.y / cell); y <= Math.floor((b.y + b.h) / cell); y++) {
        out.push(`${x},${y}`);
      }
    }
    return out;
  };
  for (const i of order) {
    const b = boxes[i]!;
    const keys = cells(b);
    const clash = keys.some((key) =>
      (grid.get(key) ?? []).some((j) => {
        const o = boxes[j]!;
        return (
          b.x < o.x + o.w + gap &&
          o.x < b.x + b.w + gap &&
          b.y < o.y + o.h + gap &&
          o.y < b.y + b.h + gap
        );
      }),
    );
    if (clash) continue;
    kept.push(i);
    for (const key of keys) {
      const list = grid.get(key);
      if (list) list.push(i);
      else grid.set(key, [i]);
    }
  }
  return kept;
}
